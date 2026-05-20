import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { invalidateServerCache } from "@/lib/serverResponseCache";

// Vercel Hobby plan caps serverless functions at 300s. Daily incremental syncs
// finish well within this; larger historical backfills should be split into
// smaller date ranges via the manual sync UI.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/* ──────────────────────────────────────────────────────────────────
 * Odoo Analytics API row shape (per the cds_analytics_integration module)
 * ────────────────────────────────────────────────────────────────── */
type OdooInvoiceRow = {
  invoice_number: string;
  invoice_date: string;           // YYYY-MM-DD
  salesperson: string;
  customer_name: string;
  customer_id: number;
  product_name: string;
  product_id: number;
  attribute_name?: string | null; // e.g. "COLOR: 4"
  qty: number;
  product_category?: string | null;
  pricelist?: string | null;
  customer_type?: string | null;
  customer_type_id?: number | null;
  branch?: string | null;
  price_total: number;
};

type OdooApiResponse = {
  status?: string;
  data?: OdooInvoiceRow[];
  pagination?: { page: number; limit: number; offset: number; total_records: number; total_pages: number };
  error?: string;
  // Odoo wraps in jsonrpc — handle both shapes.
  result?: OdooApiResponse;
  jsonrpc?: string;
};

function unwrap(json: any): OdooApiResponse {
  // The endpoint can respond as either { ... } or { jsonrpc, result: { ... } }.
  if (json && typeof json === "object" && json.result && typeof json.result === "object") return json.result;
  return json;
}

/* ──────────────────────────────────────────────────────────────────
 * Auth: cron uses CRON_SECRET, manual UI uses an authenticated super-admin.
 * ────────────────────────────────────────────────────────────────── */
async function requireAuth(req: NextRequest): Promise<{ ok: true; trigger: "cron" | "manual" } | { ok: false; res: NextResponse }> {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (cronSecret && auth === `Bearer ${cronSecret}`) return { ok: true, trigger: "cron" };

  const userClient = createServerClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await userClient
    .from("users")
    .select("role, is_super_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin" || !Boolean((profile as any).is_super_admin)) {
    return { ok: false, res: NextResponse.json({ error: "Forbidden: super admin only" }, { status: 403 }) };
  }
  return { ok: true, trigger: "manual" };
}

function getAdminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) as any;
}

/* ──────────────────────────────────────────────────────────────────
 * GET — two purposes:
 *   1) Vercel cron daily trigger: sends `Authorization: Bearer <CRON_SECRET>` → run the sync.
 *   2) Anyone else (authenticated admin UI poll) → return last sync status.
 * ────────────────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    // Cron path → run the sync. Reuses POST() so the logic stays in one place.
    return runSync(req, "cron");
  }
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });
  const { data } = await db.from("sync_state").select("*").eq("source", "odoo").maybeSingle();
  return NextResponse.json({ state: data ?? null });
}

/* ──────────────────────────────────────────────────────────────────
 * POST — run an incremental Odoo → Supabase sync.
 *
 * Body (all optional):
 *   { date_from?: "YYYY-MM-DD", date_to?: "YYYY-MM-DD", page_size?: number, max_pages?: number }
 *
 * If date_from omitted, defaults to:
 *   sync_state.last_sync_at − 1 day  (overlap window catches late edits)
 *   or 30 days ago if never run.
 * ────────────────────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.res;
  return runSync(req, auth.trigger);
}

async function runSync(req: NextRequest, trigger: "cron" | "manual") {
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });

  // Parse body — GET requests (cron) have no body; POST may.
  let body: {
    date_from?: string;
    date_to?: string;
    page_size?: number;
    max_pages?: number;
    baseUrl?: string;
    apiKey?: string;
  } = {};
  if (req.method === "POST") {
    try { body = (await req.json()) ?? {}; } catch { /* empty body is fine */ }
  }

  // Manual super-admin sync may override env creds; cron always uses env.
  const envUrl = process.env.ODOO_API_URL ?? process.env.ODOO_BASE_URL;
  const envToken = process.env.ODOO_API_TOKEN ?? process.env.ODOO_ANALYTICS_API_KEY;
  const ODOO_URL = trigger === "manual" && body.baseUrl?.trim() ? body.baseUrl.trim() : envUrl;
  const ODOO_TOKEN = trigger === "manual" && body.apiKey?.trim() ? body.apiKey.trim() : envToken;
  if (!ODOO_URL || !ODOO_TOKEN) {
    return NextResponse.json({ error: "Missing Odoo URL or API token. Set ODOO_API_URL + ODOO_API_TOKEN in env, or pass baseUrl/apiKey." }, { status: 500 });
  }

  // Resolve incremental window
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  let dateFrom = body.date_from;
  if (!dateFrom) {
    const { data: state } = await db.from("sync_state").select("last_sync_at").eq("source", "odoo").maybeSingle();
    const lastSync = state?.last_sync_at ? new Date(state.last_sync_at) : null;
    if (lastSync) {
      // overlap 1 day so late-edited invoices are caught
      const start = new Date(lastSync.getTime() - 24 * 3600 * 1000);
      dateFrom = start.toISOString().slice(0, 10);
    } else {
      const start = new Date(today.getTime() - 30 * 24 * 3600 * 1000);
      dateFrom = start.toISOString().slice(0, 10);
    }
  }
  const dateTo = body.date_to || todayStr;
  const pageSize = Math.min(Math.max(Number(body.page_size) || 500, 50), 500);
  const maxPages = Math.min(Math.max(Number(body.max_pages) || 1000, 1), 10000);

  // Mark "running" so the UI knows
  await db.from("sync_state").upsert({
    source: "odoo",
    last_run_at: new Date().toISOString(),
    last_status: "running",
    last_message: `Syncing ${dateFrom} → ${dateTo}…`,
  }, { onConflict: "source" });

  // ─── 1. Pull all pages from Odoo ────────────────────────────────
  const allRows: OdooInvoiceRow[] = [];
  let totalRecords = 0;
  let pagesFetched = 0;
  const t0 = Date.now();

  const endpoint = `${ODOO_URL.replace(/\/+$/, "")}/api/analytics/invoices`;
  // Validate the URL up-front so we surface a clear error instead of a cryptic fetch failure.
  try {
    // eslint-disable-next-line no-new
    new URL(endpoint);
  } catch {
    await db.from("sync_state").update({
      last_status: "error",
      last_message: `Bad ODOO_API_URL value: "${ODOO_URL}" — must be a full URL like https://your-odoo.example.com`,
    }).eq("source", "odoo");
    return NextResponse.json({
      error: `Bad ODOO_API_URL: "${ODOO_URL}". Must look like https://your-odoo.example.com`,
      endpoint,
      pagesFetched: 0,
    }, { status: 500 });
  }
  console.log(`[odoo-sync] trigger=${trigger} endpoint=${endpoint} window=${dateFrom}→${dateTo} pageSize=${pageSize}`);

  try {
    for (let page = 1; page <= maxPages; page++) {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "API-Key": ODOO_TOKEN },
        body: JSON.stringify({ page, limit: pageSize, date_from: dateFrom, date_to: dateTo }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Odoo HTTP ${resp.status} on page ${page}: ${text.slice(0, 300)}`);
      }
      const json = unwrap(await resp.json());
      if (json.status === "error") throw new Error(`Odoo error on page ${page}: ${json.error}`);
      const rows = Array.isArray(json.data) ? json.data : [];
      allRows.push(...rows);
      pagesFetched = page;
      totalRecords = json.pagination?.total_records ?? totalRecords;
      // Stop early if we've fetched everything reported by the server.
      if (json.pagination && totalRecords > 0 && allRows.length >= totalRecords) break;
      if (rows.length < pageSize) break;
    }
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    const cause = err?.cause ? ` (cause: ${typeof err.cause === "object" ? JSON.stringify(err.cause) : String(err.cause)})` : "";
    console.error(`[odoo-sync] fetch error at page ${pagesFetched + 1}:`, msg, cause);
    await db.from("sync_state").update({
      last_status: "error",
      last_message: `Fetch failed: ${msg}${cause}`,
    }).eq("source", "odoo");
    return NextResponse.json({
      error: msg + cause,
      endpoint,
      pagesFetched,
      hint: "Check that ODOO_API_URL is a full https:// URL and the Odoo dev instance is reachable. Try the curl in your terminal: curl -X POST '" + endpoint + "' -H 'API-Key: ...' -H 'Content-Type: application/json' -d '{\"page\":1,\"limit\":3}'",
    }, { status: 502 });
  }

  if (allRows.length === 0) {
    await db.from("sync_state").update({
      last_sync_at: new Date().toISOString(),
      last_status: "success",
      last_message: `No new records in ${dateFrom} → ${dateTo}`,
      records_processed: 0,
      records_failed: 0,
    }).eq("source", "odoo");
    return NextResponse.json({ success: true, processed: 0, failed: 0, dateFrom, dateTo });
  }

  /* ──────────────────────────────────────────────────────────────────
   * 2. Build the lookup sets (clients / products)
   *
   * IMPORTANT: Odoo's `salesperson` field on invoices is the *invoice user*
   * (often "Administrator" / "Odoo System Admin" / a branch accountant) —
   * NOT the actual sales rep. The real rep lives on `clients.salesperson_id`,
   * set when the client was originally imported (typically via Excel).
   *
   * Therefore:
   *   - We do NOT auto-create salespersons from Odoo invoice user names.
   *   - For each synced order, we use the client's existing salesperson_id.
   *   - New clients (no prior record) get NULL salesperson_id until manually
   *     assigned by an admin.
   * ────────────────────────────────────────────────────────────────── */
  const clientMap = new Map<string, { partner_id: string; name: string; customer_type: string | null }>();
  const productSet = new Set<string>();

  for (const r of allRows) {
    const pid = r.customer_id != null ? String(r.customer_id) : null;
    if (pid) {
      const prev = clientMap.get(pid);
      const cust = (r.customer_type ?? "").trim() || null;
      if (!prev) {
        clientMap.set(pid, { partner_id: pid, name: (r.customer_name ?? pid).trim(), customer_type: cust });
      } else if (!prev.customer_type && cust) {
        prev.customer_type = cust;
      }
    }
    const pname = (r.product_name ?? "").trim();
    if (pname) productSet.add(pname);
  }

  /* 3. Upsert products by name */
  const productInserts = Array.from(productSet).map((name) => ({ name }));
  if (productInserts.length) {
    for (let i = 0; i < productInserts.length; i += 200) {
      const chunk = productInserts.slice(i, i + 200);
      await db.from("products").upsert(chunk, { onConflict: "name", ignoreDuplicates: true });
    }
  }

  /* 4. Upsert clients (without salesperson_id — that stays on the client record,
   *    set elsewhere). NEW clients get no salesperson assignment until an admin
   *    assigns one (or a later Excel import sets it). */
  const clientInserts = Array.from(clientMap.values()).map((c) => ({
    partner_id: c.partner_id,
    name: c.name,
    ...(c.customer_type ? { customer_type: c.customer_type } : {}),
  }));
  for (let i = 0; i < clientInserts.length; i += 300) {
    const chunk = clientInserts.slice(i, i + 300);
    // ignoreDuplicates=false so name / customer_type can be refreshed,
    // but `salesperson_id` is intentionally not in the payload so it isn't touched.
    await db.from("clients").upsert(chunk, { onConflict: "partner_id", ignoreDuplicates: false });
  }

  /* 7. Fetch full lookup maps (client_id by partner_id, product_id by name) */
  const fetchAll = async <T,>(table: string, cols: string): Promise<T[]> => {
    const PAGE = 1000;
    const out: T[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await db.from(table).select(cols).range(from, from + PAGE - 1);
      if (error || !data?.length) break;
      out.push(...(data as T[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return out;
  };
  const [clientData, productData] = await Promise.all([
    fetchAll<{ id: string; partner_id: string; salesperson_id: string | null }>("clients", "id, partner_id, salesperson_id"),
    fetchAll<{ id: string; name: string }>("products", "id, name"),
  ]);
  const clientIdByPid = new Map<string, string>((clientData as any[]).map((c) => [c.partner_id, c.id]));
  const clientSpByPid = new Map<string, string | null>((clientData as any[]).map((c) => [c.partner_id, c.salesperson_id ?? null]));
  const productIdByName = new Map<string, string>((productData as any[]).map((p) => [p.name, p.id]));

  /* 8. Build order rows.
   *    Each order's salesperson_id is taken from the client record (the actual sales rep
   *    assigned to that client), NOT from the Odoo invoice's `salesperson` field which
   *    is the admin/accountant who created the invoice. */
  const orderInserts: any[] = [];
  const failReasons: Record<string, number> = {};
  let skipped = 0;

  for (const r of allRows) {
    const pid = r.customer_id != null ? String(r.customer_id) : null;
    const pname = (r.product_name ?? "").trim();
    const clientId = pid ? clientIdByPid.get(pid) : undefined;
    const productId = pname ? productIdByName.get(pname) : undefined;
    // Use the client's existing sales rep — fall back to NULL for new clients.
    const salespersonId = pid ? clientSpByPid.get(pid) ?? null : null;

    if (!clientId) { skipped++; failReasons.no_client = (failReasons.no_client || 0) + 1; continue; }
    if (!productId) { skipped++; failReasons.no_product = (failReasons.no_product || 0) + 1; continue; }
    if (!r.invoice_date) { skipped++; failReasons.no_invoice_date = (failReasons.no_invoice_date || 0) + 1; continue; }

    const d = new Date(r.invoice_date);
    if (Number.isNaN(d.getTime())) { skipped++; failReasons.bad_date = (failReasons.bad_date || 0) + 1; continue; }
    const month = d.getUTCMonth() + 1;
    const year = d.getUTCFullYear();

    const qty = Number(r.qty) || 0;
    const total = Number(r.price_total) || 0;
    const invRef = (r.invoice_number ?? "").trim().slice(0, 512);
    const branch = (r.branch ?? "").trim() || null;
    const category = ((r.product_category ?? "").trim() || null)?.slice(0, 512) ?? null;
    const pricelist = ((r.pricelist ?? "").trim() || null)?.slice(0, 256) ?? null;
    const attrLabel = (r.attribute_name ?? "").trim();
    const meterBreakdown = attrLabel ? [{ label: attrLabel, meters: qty }] : null;

    orderInserts.push({
      client_id: clientId,
      salesperson_id: salespersonId,
      product_id: productId,
      month,
      year,
      quantity: qty,
      invoice_total: total,
      invoice_date: r.invoice_date,
      invoice_ref: invRef,
      branch,
      category,
      pricelist,
      ...(meterBreakdown ? { meter_breakdown: meterBreakdown } : {}),
    });
  }

  /* 9. Upsert orders — same unique key used by the Excel path. */
  const CHUNK = 500;
  const CONCURRENCY = 5;
  let inserted = 0;
  let orderErrors = 0;
  let firstDbError = "";
  const chunks: any[][] = [];
  for (let i = 0; i < orderInserts.length; i += CHUNK) chunks.push(orderInserts.slice(i, i + CHUNK));

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((chunk) =>
        db.from("orders").upsert(chunk, {
          onConflict: "client_id,product_id,month,year,salesperson_id,invoice_ref",
          ignoreDuplicates: false,
        }).select("id")
      )
    );
    for (let j = 0; j < results.length; j++) {
      const { data, error } = results[j];
      if (error) {
        if (!firstDbError) firstDbError = error.message;
        orderErrors += batch[j].length;
      } else {
        inserted += data?.length ?? 0;
      }
    }
  }

  /* 10. Refresh MV + invalidate caches */
  try { await db.rpc("refresh_analytics_materialized_views"); } catch (e) { /* non-fatal */ }
  invalidateServerCache("urgent-");
  invalidateServerCache("order-distinct");

  /* 11. Activity log */
  try {
    await db.from("activity_logs").insert({
      activity_type: "EXCEL_UPLOAD",
      description: `Odoo sync (${trigger}): ${inserted} orders / ${skipped + orderErrors} skipped, range ${dateFrom} → ${dateTo}`,
      metadata: { source: "odoo", trigger: trigger, dateFrom, dateTo, pagesFetched, totalRecords,
                  fetchedRows: allRows.length, inserted, skipped, orderErrors, failReasons,
                  firstDbError: firstDbError || null, durationMs: Date.now() - t0 },
    });
  } catch { /* non-fatal */ }

  /* 12. Mark sync_state success */
  await db.from("sync_state").update({
    last_sync_at: new Date().toISOString(),
    last_status: "success",
    last_message: `OK: ${inserted} orders inserted/updated, ${skipped + orderErrors} skipped`,
    records_processed: inserted,
    records_failed: skipped + orderErrors,
  }).eq("source", "odoo");

  return NextResponse.json({
    success: true,
    trigger: trigger,
    dateFrom, dateTo,
    pagesFetched,
    fetchedRows: allRows.length,
    processed: inserted,
    skipped,
    orderErrors,
    failReasons,
    firstDbError: firstDbError || null,
    durationMs: Date.now() - t0,
  });
}
