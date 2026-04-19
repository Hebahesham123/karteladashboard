import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function requireAdmin() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await supabase.from("users").select("id, role").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { userId: user.id };
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });

  const branchParam = req.nextUrl.searchParams.get("branch");
  const limit = Math.min(500, Math.max(20, Number(req.nextUrl.searchParams.get("limit")) || 200));
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset")) || 0);

  if (branchParam === null) {
    return NextResponse.json({ error: "branch query required (use __none__ for empty branch)" }, { status: 400 });
  }

  const isNone = branchParam === "__none__";
  let q = db
    .from("orders")
    .select(
      "id, month, year, quantity, invoice_total, invoice_ref, branch, invoice_date, category, pricelist, created_at, client_id, product_id, salesperson_id, meter_breakdown"
    )
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (isNone) {
    q = q.or('branch.is.null,branch.eq.""');
  } else {
    q = q.eq("branch", branchParam);
  }

  const { data: orders, error: orderErr } = await q;
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });

  const clientIds = Array.from(new Set((orders ?? []).map((o) => o.client_id).filter(Boolean)));
  const productIds = Array.from(new Set((orders ?? []).map((o) => o.product_id).filter(Boolean)));
  const spIds = Array.from(new Set((orders ?? []).map((o) => o.salesperson_id).filter(Boolean)));

  const [clientsRes, productsRes, spsRes] = await Promise.all([
    clientIds.length
      ? db.from("clients").select("id, name, partner_id").in("id", clientIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? db.from("products").select("id, name").in("id", productIds)
      : Promise.resolve({ data: [], error: null }),
    spIds.length
      ? db.from("salespersons").select("id, code, name").in("id", spIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (clientsRes.error) return NextResponse.json({ error: clientsRes.error.message }, { status: 500 });
  if (productsRes.error) return NextResponse.json({ error: productsRes.error.message }, { status: 500 });
  if (spsRes.error) return NextResponse.json({ error: spsRes.error.message }, { status: 500 });

  const clientMap = new Map((clientsRes.data ?? []).map((c: { id: string }) => [c.id, c]));
  const productMap = new Map((productsRes.data ?? []).map((p: { id: string }) => [p.id, p]));
  const spMap = new Map((spsRes.data ?? []).map((s: { id: string }) => [s.id, s]));

  const rows = (orders ?? []).map((o) => {
    const c = clientMap.get(o.client_id as string) as { name?: string; partner_id?: string } | undefined;
    const p = productMap.get(o.product_id as string) as { name?: string } | undefined;
    const sp = o.salesperson_id ? (spMap.get(o.salesperson_id as string) as { code?: string; name?: string } | undefined) : null;
    const invRaw = o.invoice_ref != null ? String(o.invoice_ref).trim() : "";
    const catRaw = o.category != null ? String(o.category).trim() : "";
    /** Some exports put journal/invoice id in category when the invoice column was not mapped. */
    const fromCategory =
      !invRaw &&
      catRaw &&
      (/oline\//i.test(catRaw) ||
        /^[A-Z]{1,4}-[A-Z]{0,4}\/\d{4}\/\d+/i.test(catRaw.trim()) ||
        /^[A-Z]{2,}-S\/\d{4}\/\d+/i.test(catRaw.trim()));
    const invoice_ref = invRaw || (fromCategory ? catRaw : "");
    return {
      id: o.id,
      client_id: o.client_id as string,
      month: o.month,
      year: o.year,
      quantity: Number(o.quantity) || 0,
      invoice_total: Number(o.invoice_total) || 0,
      invoice_ref,
      branch: o.branch,
      invoice_date: o.invoice_date,
      category: o.category,
      pricelist: o.pricelist,
      created_at: o.created_at,
      meter_breakdown: o.meter_breakdown,
      client_name: c?.name ?? "—",
      partner_id: c?.partner_id ?? "—",
      product_name: p?.name ?? "—",
      salesperson_code: sp?.code ?? null,
      salesperson_name: sp?.name ?? null,
    };
  });

  return NextResponse.json({ rows, limit, offset }, { headers: { "Cache-Control": "no-store, private" } });
}
