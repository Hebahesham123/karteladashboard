import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { getOrSetServerCache, invalidateServerCache } from "@/lib/serverResponseCache";

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

  const salespersonId = req.nextUrl.searchParams.get("salespersonId");
  const month = Number(req.nextUrl.searchParams.get("month"));
  const year = Number(req.nextUrl.searchParams.get("year"));
  if (!salespersonId) return NextResponse.json({ error: "salespersonId is required" }, { status: 400 });

  const sps = await getOrSetServerCache("urgent-admin:salespersons", 60_000, async () => {
    const { data, error } = await db
      .from("salespersons")
      .select("id, code, name")
      .eq("is_active", true)
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

  if (salespersonId === "__init__") {
    return NextResponse.json({ salespersons: sps ?? [], rows: [] });
  }

  const monthKey = Number.isFinite(month) && month >= 1 && month <= 12 ? month : "all";
  const yearKey = Number.isFinite(year) && year >= 2000 && year <= 2100 ? year : "all";
  const rows = await getOrSetServerCache(
    `urgent-admin:rows:${salespersonId}:${monthKey}:${yearKey}`,
    20_000,
    async () => {
      let orderQ = db
        .from("orders")
        .select("id, client_id, product_id, salesperson_id, month, year, quantity, invoice_total, invoice_ref, category, pricelist")
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

      const [clientsRes, productsRes, assignedRes] = await Promise.all([
        clientIds.length
          ? db.from("clients").select("id, name, partner_id, current_status, notes").in("id", clientIds)
          : Promise.resolve({ data: [], error: null }),
        productIds.length
          ? db.from("products").select("id, name").in("id", productIds)
          : Promise.resolve({ data: [], error: null }),
        orderIds.length
          ? db
              .from("urgent_order_assignments")
              .select("order_id, note, is_active")
              .eq("salesperson_id", salespersonId)
              .in("order_id", orderIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (clientsRes.error) throw new Error(clientsRes.error.message);
      if (productsRes.error) throw new Error(productsRes.error.message);
      if (assignedRes.error) throw new Error(assignedRes.error.message);

      const clientMap = new Map((clientsRes.data ?? []).map((c) => [c.id, c]));
      const productMap = new Map((productsRes.data ?? []).map((p) => [p.id, p]));
      const assignedMap = new Map((assignedRes.data ?? []).map((a) => [a.order_id, a]));

      return (orders ?? []).map((o) => {
        const c = clientMap.get(o.client_id);
        const p = productMap.get(o.product_id);
        const a = assignedMap.get(o.id);
        return {
          id: o.id,
          invoice_ref: o.invoice_ref,
          category: o.category,
          pricelist: o.pricelist,
          month: o.month,
          year: o.year,
          quantity: Number(o.quantity) || 0,
          invoice_total: Number(o.invoice_total) || 0,
          client_name: c?.name ?? "—",
          partner_id: c?.partner_id ?? "—",
          product_name: p?.name ?? "—",
          current_status: c?.current_status ?? "NEW",
          notes: c?.notes ?? null,
          assigned: Boolean(a?.is_active),
          assigned_note: a?.note ?? null,
        };
      });
    }
  );

  return NextResponse.json(
    { salespersons: sps ?? [], rows },
    { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } }
  );
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });

  const body = (await req.json()) as {
    orderId?: string;
    salespersonId?: string;
    note?: string;
    assigned?: boolean;
  };
  if (!body.orderId || !body.salespersonId || typeof body.assigned !== "boolean") {
    return NextResponse.json({ error: "orderId, salespersonId and assigned are required" }, { status: 400 });
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

  invalidateServerCache(`urgent-admin:rows:${body.salespersonId}:`);
  invalidateServerCache("urgent-my:");

  return NextResponse.json({ ok: true });
}
