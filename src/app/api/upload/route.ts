import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { invalidateServerCache } from "@/lib/serverResponseCache";

/** Fetch ALL rows from a table with pagination (avoids URL-length and encoding issues) */
async function fetchAll<T>(db: any, table: string, selectColumns: string): Promise<T[]> {
  const PAGE = 1000;
  const results: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await db.from(table).select(selectColumns).range(from, from + PAGE - 1);
    if (error) { console.error(`fetchAll ${table} error:`, error.message); break; }
    if (!data?.length) break;
    results.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return results;
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const db = admin as any;

  try {
    const body = await req.json();
    const { rows, month, year, userId, filename } = body;

    if (!rows?.length) {
      return NextResponse.json({ error: "No rows provided" }, { status: 400 });
    }

    // ── Step 1: Collect unique values ────────────────────────────────
    const spMap   = new Map<string, string>();   // code → name
    const productSet = new Set<string>();
    const clientMap  = new Map<string, { partner_id: string; name: string; salesperson_code: string; customer_type: string }>();

    for (const row of rows) {
      const spCode = row.salesperson_code?.trim();
      const spName = row.salesperson_name?.trim() || spCode;
      if (spCode) spMap.set(spCode, spName);
      if (row.product_name?.trim()) productSet.add(row.product_name.trim());
      const pid = row.partner_id?.trim();
      if (pid) {
        if (!clientMap.has(pid)) {
          clientMap.set(pid, {
            partner_id: pid,
            name: row.partner_name?.trim() || pid,
            salesperson_code: spCode || "",
            customer_type: row.customer_type?.trim() || "",
          });
        } else if (!clientMap.get(pid)!.customer_type && row.customer_type?.trim()) {
          // Update customer_type if not yet set
          clientMap.get(pid)!.customer_type = row.customer_type.trim();
        }
      }
    }

    // ── Step 2: Batch upsert salespersons ────────────────────────────
    const spInserts = Array.from(spMap.entries()).map(([code, name]) => ({ code, name }));
    if (spInserts.length) {
      const { error: spErr } = await db.from("salespersons").upsert(spInserts, { onConflict: "code" });
      if (spErr) console.error("salespersons upsert error:", spErr);
    }

    // ── Step 3: Batch upsert products (parallel) ─────────────────────
    const productInserts = Array.from(productSet).map((name) => ({ name }));
    if (productInserts.length) {
      const prodChunks = [];
      for (let i = 0; i < productInserts.length; i += 100) prodChunks.push(productInserts.slice(i, i + 100));
      await Promise.all(prodChunks.map((chunk) => db.from("products").upsert(chunk, { onConflict: "name" })));
    }

    // ── Step 4: Fetch ALL salespersons — build lookup by code AND name ─
    // Fetch everything so there's no chance of missing IDs
    const { data: allSpData } = await db.from("salespersons").select("id, code, name");
    const spIdMap = new Map<string, string>();
    for (const s of (allSpData || []) as any[]) {
      if (s.code?.trim()) spIdMap.set(s.code.trim(), s.id);
      if (s.name?.trim()) spIdMap.set(s.name.trim(), s.id); // fallback by full name
    }
    console.log(`Loaded ${spIdMap.size} salesperson lookup entries`);

    // ── Step 5: Batch upsert clients (with salesperson_id resolved) ──
    const clientInserts = Array.from(clientMap.values()).map((c) => {
      const sid = spIdMap.get(c.salesperson_code)
               || spIdMap.get(c.salesperson_code?.trim())
               || null;
      return {
        partner_id:    c.partner_id,
        name:          c.name,
        salesperson_id: sid,
        ...(c.customer_type ? { customer_type: c.customer_type } : {}),
      };
    });

    // Upsert clients in parallel chunks of 300
    const clientChunks = [];
    for (let i = 0; i < clientInserts.length; i += 300) clientChunks.push(clientInserts.slice(i, i + 300));
    await Promise.all(clientChunks.map((chunk) => db.from("clients").upsert(chunk, { onConflict: "partner_id" })));

    // ── Steps 6 & 7: Fetch ALL clients and products (no URL-length / encoding issues) ──
    const [clientData, productData] = await Promise.all([
      fetchAll<{ id: string; partner_id: string }>(db, "clients",  "id, partner_id"),
      fetchAll<{ id: string; name: string }>      (db, "products", "id, name"),
    ]);
    const clientIdMap  = new Map<string, string>((clientData  as any[]).map((c) => [c.partner_id, c.id]));
    const productIdMap = new Map<string, string>((productData as any[]).map((p) => [p.name,       p.id]));
    console.log(`clientIdMap: ${clientIdMap.size}, productIdMap: ${productIdMap.size}`);

    // ── Step 8: Create upload batch record ───────────────────────────
    let batchId: string | null = null;
    try {
      const { data: batch } = await db
        .from("upload_batches")
        .insert({
          uploaded_by: userId,
          filename,
          total_rows: rows.length,
          processed_rows: 0,
          failed_rows: 0,
          month,
          year,
          status: "processing",
        })
        .select("id")
        .single();
      batchId = batch?.id || null;
    } catch (e) {
      console.warn("Could not create upload batch record:", e);
    }

    // ── Step 9: Build order inserts ──────────────────────────────────
    const orderInserts = [];
    let failedRows = 0;
    const failReasons: Record<string, number> = {};

    for (const row of rows) {
      const pid = row.partner_id?.trim();
      const pname = row.product_name?.trim();
      const spCode = row.salesperson_code?.trim();

      const clientId  = pid ? clientIdMap.get(pid) : undefined;
      const productId = pname ? productIdMap.get(pname) : undefined;
      // Try code first, then full salesperson name as fallback
      const spName2   = row.salesperson_name?.trim();
      const spId      = (spCode && spIdMap.get(spCode))
                     || (spName2 && spIdMap.get(spName2))
                     || undefined;

      if (!clientId) {
        failedRows++;
        failReasons["no_client_id"] = (failReasons["no_client_id"] || 0) + 1;
        continue;
      }
      if (!productId) {
        failedRows++;
        failReasons["no_product_id"] = (failReasons["no_product_id"] || 0) + 1;
        continue;
      }

      // Use per-row month/year from Excel, fallback to form values
      const rowMonth = Number(row.month);
      const rowYear  = Number(row.year);
      const orderMonth = rowMonth >= 1 && rowMonth <= 12 ? rowMonth : Number(month);
      const orderYear  = rowYear  >= 2000 && rowYear  <= 2100 ? rowYear  : Number(year);

      const qtyNum = Number(row.quantity) || 0;
      const breakdown = Array.isArray(row.meter_breakdown)
        ? row.meter_breakdown
            .map((x: any) => ({
              label: String(x?.label ?? x?.name ?? "").trim(),
              meters: Number(x?.meters) || 0,
            }))
            .filter((x: { label: string; meters: number }) => x.label && x.meters > 0)
        : [];
      const invRef =
        row.invoice_ref != null && String(row.invoice_ref).trim() !== ""
          ? String(row.invoice_ref).trim().slice(0, 512)
          : "";
      const catRaw = row.category != null ? String(row.category).trim() : "";
      const plRaw = row.pricelist != null ? String(row.pricelist).trim() : "";
      orderInserts.push({
        client_id: clientId,
        salesperson_id: spId || null,
        product_id: productId,
        month: orderMonth,
        year: orderYear,
        quantity: qtyNum,
        invoice_total: Number(row.invoice_total) || 0,
        branch: row.branch?.trim() || null,
        invoice_ref: invRef,
        category: catRaw ? catRaw.slice(0, 512) : null,
        pricelist: plRaw ? plRaw.slice(0, 256) : null,
        upload_batch_id: batchId,
        ...(row.invoice_date && String(row.invoice_date).trim()
          ? { invoice_date: String(row.invoice_date).trim().slice(0, 10) }
          : {}),
        ...(breakdown.length > 0 ? { meter_breakdown: breakdown } : {}),
      });
    }

    // ── Step 10: Upsert orders — parallel chunks of 500 ─────────────
    // Using UPSERT (onConflict) to prevent duplicate rows when the same
    // Excel is uploaded more than once. Requires:
    //   UNIQUE (client_id, product_id, month, year, salesperson_id) — see ADD-orders-unique-with-salesperson.sql
    const CHUNK_SIZE  = 500;
    const CONCURRENCY = 5;
    let insertedOrders = 0;
    let orderErrors    = 0;
    let firstDbError   = "";

    const orderChunks: (typeof orderInserts)[] = [];
    for (let i = 0; i < orderInserts.length; i += CHUNK_SIZE) {
      orderChunks.push(orderInserts.slice(i, i + CHUNK_SIZE));
    }

    for (let i = 0; i < orderChunks.length; i += CONCURRENCY) {
      const batch = orderChunks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((chunk) =>
          db.from("orders")
            .upsert(chunk, {
              onConflict: "client_id,product_id,month,year,salesperson_id,invoice_ref",
              ignoreDuplicates: false,
            })
            .select("id")
        )
      );
      for (let j = 0; j < results.length; j++) {
        const { data: inserted, error: oErr } = results[j];
        if (oErr) {
          if (!firstDbError) firstDbError = oErr.message;
          console.error("orders chunk error:", oErr.message);
          orderErrors += batch[j].length;
        } else {
          insertedOrders += inserted?.length || 0;
        }
      }
    }

    failedRows += orderErrors;

    // ── Step 13: Update batch status ─────────────────────────────────
    if (batchId) {
      await db.from("upload_batches").update({
        status: "completed",
        processed_rows: insertedOrders,
        failed_rows: failedRows,
      }).eq("id", batchId);
    }

    // ── Step 14: Log activity ─────────────────────────────────────────
    try {
      await db.from("activity_logs").insert({
        user_id: userId,
        activity_type: "EXCEL_UPLOAD",
        description: `Uploaded ${filename}: ${insertedOrders} orders, ${failedRows} failed`,
        metadata: { filename, total: rows.length, success: insertedOrders, errors: failedRows, failReasons, month, year },
      });
    } catch (e) {
      console.warn("Could not insert activity log:", e);
    }

    invalidateServerCache("urgent-");
    invalidateServerCache("order-distinct");

    return NextResponse.json({
      success: true,
      processed: insertedOrders,
      failed: failedRows,
      clients: clientInserts.length,
      products: productInserts.length,
      salespersons: spInserts.length,
      debug: {
        failReasons,
        firstDbError: firstDbError || null,
        clientMapSize: clientIdMap.size,
        productMapSize: productIdMap.size,
      },
    });

  } catch (err: any) {
    console.error("Upload fatal error:", err);
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
