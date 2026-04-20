import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { getOrSetServerCache, invalidateServerCache } from "@/lib/serverResponseCache";
import { isKartelaProductName, kartelaMetersFromMeterBreakdown } from "@/lib/kartelaProduct";
import { canAccessSalesperson, filterSalespersonsByScope, resolveAdminBranchScope, resolveAdminScope } from "@/lib/adminScope";

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
  let scope;
  let branchScope = { branches: [] as string[] };
  try {
    scope = await resolveAdminScope(db, admin.userId);
    branchScope = await resolveAdminBranchScope(db, admin.userId);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Forbidden";
    const status = msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }

  const scopedBranches = (branchScope.branches ?? []).map((b) => String(b).trim()).filter(Boolean);
  const scopeSalespersonIds = new Set<string>(scope.salespersonIds);
  if (!scope.isSuperAdmin && scopeSalespersonIds.size === 0 && scopedBranches.length > 0) {
    for (const branch of scopedBranches) {
      const { data, error } = await db
        .from("orders")
        .select("salesperson_id")
        .ilike("branch", `%${branch}%`)
        .not("salesperson_id", "is", null)
        .limit(5000);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const row of data ?? []) {
        const sid = String((row as { salesperson_id?: string | null }).salesperson_id ?? "").trim();
        if (sid) scopeSalespersonIds.add(sid);
      }
    }
  }

  const salespersonId = req.nextUrl.searchParams.get("salespersonId");
  const month = Number(req.nextUrl.searchParams.get("month"));
  const year = Number(req.nextUrl.searchParams.get("year"));
  if (!salespersonId) return NextResponse.json({ error: "salespersonId is required" }, { status: 400 });

  const sps = await getOrSetServerCache(`urgent-admin:salespersons:${admin.userId}`, 60_000, async () => {
    const { data, error } = await db
      .from("salespersons")
      .select("id, code, name")
      .eq("is_active", true)
      .order("name");
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { id: string; code: string; name: string }[];
    if (scope.isSuperAdmin) return rows;
    if (scopeSalespersonIds.size > 0) return rows.filter((r) => scopeSalespersonIds.has(r.id));
    return filterSalespersonsByScope(scope, rows);
  });

  if (salespersonId === "__init__") {
    return NextResponse.json({ salespersons: sps ?? [], rows: [] });
  }
  if (!scope.isSuperAdmin) {
    const allowedByDerived = scopeSalespersonIds.size > 0 ? scopeSalespersonIds.has(salespersonId) : false;
    const allowedByScope = canAccessSalesperson(scope, salespersonId);
    if (!allowedByDerived && !allowedByScope) {
      return NextResponse.json({ error: "Forbidden for this salesperson" }, { status: 403 });
    }
  }

  const monthKey = Number.isFinite(month) && month >= 1 && month <= 12 ? month : "all";
  const yearKey = Number.isFinite(year) && year >= 2000 && year <= 2100 ? year : "all";
  const rows = await getOrSetServerCache(
    `urgent-admin:rows:v2:${admin.userId}:${salespersonId}:${monthKey}:${yearKey}`,
    20_000,
    async () => {
      let orderQ = db
        .from("orders")
        .select(
          "id, client_id, product_id, salesperson_id, month, year, quantity, invoice_total, invoice_ref, category, pricelist, branch, invoice_date, meter_breakdown, created_at"
        )
        .eq("salesperson_id", salespersonId)
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1500);
      if (Number.isFinite(month) && month >= 1 && month <= 12) orderQ = orderQ.eq("month", month);
      if (Number.isFinite(year) && year >= 2000 && year <= 2100) orderQ = orderQ.eq("year", year);
      const { data: orders, error: orderErr } = await orderQ;
      if (orderErr) throw new Error(orderErr.message);

      const clientIds = Array.from(new Set((orders ?? []).map((o) => o.client_id).filter(Boolean)));
      const productIds = Array.from(new Set((orders ?? []).map((o) => o.product_id).filter(Boolean)));
      const orderIds = (orders ?? []).map((o) => o.id);

      let assignedRows: any[] = [];
      if (orderIds.length) {
        const res = await db
          .from("urgent_order_assignments")
          .select("order_id, note, is_active, client_status")
          .eq("salesperson_id", salespersonId)
          .in("order_id", orderIds);
        if (res.error && String(res.error.message ?? "").includes("client_status")) {
          const fallback = await db
            .from("urgent_order_assignments")
            .select("order_id, note, is_active")
            .eq("salesperson_id", salespersonId)
            .in("order_id", orderIds);
          if (fallback.error) throw new Error(fallback.error.message);
          assignedRows = fallback.data ?? [];
        } else {
          if (res.error) throw new Error(res.error.message);
          assignedRows = res.data ?? [];
        }
      }

      const [clientsRes, productsRes] = await Promise.all([
        clientIds.length
          ? db.from("clients").select("id, name, partner_id, current_status, notes").in("id", clientIds)
          : Promise.resolve({ data: [], error: null }),
        productIds.length
          ? db.from("products").select("id, name").in("id", productIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (clientsRes.error) throw new Error(clientsRes.error.message);
      if (productsRes.error) throw new Error(productsRes.error.message);

      const clientMap = new Map((clientsRes.data ?? []).map((c) => [c.id, c]));
      const productMap = new Map((productsRes.data ?? []).map((p) => [p.id, p]));
      const assignedMap = new Map((assignedRows ?? []).map((a) => [a.order_id, a]));
      let latestOrderNote = new Map<string, string>();
      let orderNoteCount = new Map<string, number>();
      let latestClientNote = new Map<string, string>();
      let clientNoteCount = new Map<string, number>();
      if (orderIds.length) {
        const { data: logs, error: logErr } = await db
          .from("activity_logs")
          .select("entity_id, metadata, created_at")
          .eq("activity_type", "NOTE_ADDED")
          .eq("entity_type", "order")
          .in("entity_id", orderIds)
          .order("created_at", { ascending: false });
        if (logErr) throw new Error(logErr.message);
        for (const log of logs ?? []) {
          const oid = String((log as any).entity_id ?? "");
          if (!oid) continue;
          orderNoteCount.set(oid, (orderNoteCount.get(oid) ?? 0) + 1);
          if (latestOrderNote.has(oid)) continue;
          const msg = String((log as any)?.metadata?.note ?? "").trim();
          if (!msg) continue;
          latestOrderNote.set(oid, msg);
        }
      }
      if (clientIds.length) {
        const { data: clientLogs, error: clientLogErr } = await db
          .from("activity_logs")
          .select("entity_id, metadata, created_at")
          .eq("activity_type", "NOTE_ADDED")
          .eq("entity_type", "client")
          .in("entity_id", clientIds)
          .order("created_at", { ascending: false });
        if (clientLogErr) throw new Error(clientLogErr.message);
        for (const log of clientLogs ?? []) {
          const cid = String((log as any).entity_id ?? "");
          if (!cid) continue;
          clientNoteCount.set(cid, (clientNoteCount.get(cid) ?? 0) + 1);
          if (latestClientNote.has(cid)) continue;
          const msg = String((log as any)?.metadata?.note ?? "").trim();
          if (!msg) continue;
          latestClientNote.set(cid, msg);
        }
      }

      const branchByClientInvoice = new Map<string, string>();
      for (const o of orders ?? []) {
        const cid = o.client_id as string | null;
        const inv = String(o.invoice_ref ?? "")
          .trim()
          .toLowerCase();
        const b = String((o as { branch?: string | null }).branch ?? "").trim();
        if (cid && inv && b) {
          const k = `${cid}|${inv}`;
          if (!branchByClientInvoice.has(k)) branchByClientInvoice.set(k, b);
        }
      }

      return (orders ?? []).map((o) => {
        const c = clientMap.get(o.client_id);
        const p = productMap.get(o.product_id);
        const a = assignedMap.get(o.id);
        const urgentStatus = (a as any)?.client_status as string | null | undefined;
        const orderNote = latestOrderNote.get(o.id) ?? null;
        const clientLogNote = latestClientNote.get(o.client_id) ?? null;
        const productName = p?.name ?? "—";
        const invDate = (o as { invoice_date?: string | null }).invoice_date ?? null;
        const createdAt = (o as { created_at?: string }).created_at ?? null;
        const lineDateIso = invDate || (createdAt ? String(createdAt).slice(0, 10) : null);
        let branchVal = String((o as { branch?: string | null }).branch ?? "").trim() || null;
        if (!branchVal && o.client_id && o.invoice_ref) {
          const k = `${o.client_id}|${String(o.invoice_ref).trim().toLowerCase()}`;
          branchVal = branchByClientInvoice.get(k) ?? null;
        }
        const mb = (o as { meter_breakdown?: unknown }).meter_breakdown;
        const fromBreakdown = kartelaMetersFromMeterBreakdown(mb);
        const qty = Number(o.quantity) || 0;
        const isKLine = isKartelaProductName(productName);
        const kartela_qty_display: number | null = isKLine ? qty : fromBreakdown > 0 ? fromBreakdown : null;
        return {
          id: o.id,
          invoice_ref: o.invoice_ref,
          category: o.category,
          pricelist: o.pricelist,
          branch: branchVal,
          invoice_date: invDate,
          line_date: lineDateIso,
          created_at: createdAt,
          month: o.month,
          year: o.year,
          quantity: qty,
          invoice_total: Number(o.invoice_total) || 0,
          client_name: c?.name ?? "—",
          partner_id: c?.partner_id ?? "—",
          product_name: productName,
          is_kartela_line: isKLine,
          kartela_qty_display,
          meter_breakdown: mb ?? null,
          current_status: (urgentStatus || c?.current_status || "NEW") as string,
          notes: orderNote || clientLogNote || c?.notes || null,
          notes_count: orderNote ? (orderNoteCount.get(o.id) ?? 0) : (clientNoteCount.get(o.client_id) ?? 0),
          assigned: Boolean(a?.is_active),
          assigned_note: a?.note ?? null,
        };
      });
    }
  );

  return NextResponse.json(
    { salespersons: sps ?? [], rows },
    { headers: { "Cache-Control": "no-store, private" } }
  );
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });
  let scope;
  try {
    scope = await resolveAdminScope(db, admin.userId);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Forbidden";
    const status = msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }

  const body = (await req.json()) as {
    orderId?: string;
    salespersonId?: string;
    note?: string;
    assigned?: boolean;
    /** Persist assign note only (upsert), without toggling assignment. */
    updateNoteOnly?: boolean;
  };

  if (body.updateNoteOnly === true) {
    if (!body.orderId || !body.salespersonId || typeof body.assigned !== "boolean") {
      return NextResponse.json(
        { error: "orderId, salespersonId and assigned (current state) are required" },
        { status: 400 }
      );
    }
    if (!canAccessSalesperson(scope, body.salespersonId)) {
      return NextResponse.json({ error: "Forbidden for this salesperson" }, { status: 403 });
    }
    const { error } = await db.from("urgent_order_assignments").upsert(
      {
        order_id: body.orderId,
        salesperson_id: body.salespersonId,
        assigned_by: admin.userId,
        note: (body.note ?? "").trim() || null,
        is_active: body.assigned,
      },
      { onConflict: "order_id,salesperson_id" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    invalidateServerCache(`urgent-admin:rows:v2:${admin.userId}:${body.salespersonId}:`);
    invalidateServerCache("urgent-my:");
    return NextResponse.json({ ok: true });
  }

  if (!body.orderId || !body.salespersonId || typeof body.assigned !== "boolean") {
    return NextResponse.json({ error: "orderId, salespersonId and assigned are required" }, { status: 400 });
  }
  if (!canAccessSalesperson(scope, body.salespersonId)) {
    return NextResponse.json({ error: "Forbidden for this salesperson" }, { status: 403 });
  }

  if (body.assigned) {
    const { error } = await db.from("urgent_order_assignments").upsert(
      {
        order_id: body.orderId,
        salesperson_id: body.salespersonId,
        assigned_by: admin.userId,
        note: (body.note ?? "").trim() || null,
        is_active: true,
      },
      { onConflict: "order_id,salesperson_id" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await db
      .from("urgent_order_assignments")
      .update({ is_active: false, assigned_by: admin.userId, note: (body.note ?? "").trim() || null })
      .eq("order_id", body.orderId)
      .eq("salesperson_id", body.salespersonId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateServerCache(`urgent-admin:rows:v2:${admin.userId}:${body.salespersonId}:`);
  invalidateServerCache("urgent-my:");

  return NextResponse.json({ ok: true });
}
