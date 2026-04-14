import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { getOrSetServerCache } from "@/lib/serverResponseCache";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function GET() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("users").select("id, role").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== "sales") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });

  const { data: sp } = await db.from("salespersons").select("id").eq("user_id", user.id).maybeSingle();
  if (!sp?.id) return NextResponse.json({ rows: [] });

  const rows = await getOrSetServerCache(`urgent-my:${user.id}`, 30_000, async () => {
    const { data: assignments, error: aErr } = await db
      .from("urgent_order_assignments")
      .select("order_id, note, created_at")
      .eq("salesperson_id", sp.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (aErr) throw new Error(aErr.message);

    const orderIds = (assignments ?? []).map((a) => a.order_id);
    if (!orderIds.length) return [];

    const { data: orders, error: orderErr } = await db
      .from("orders")
      .select("id, client_id, product_id, month, year, quantity, invoice_total, invoice_ref, category, pricelist")
      .in("id", orderIds);
    if (orderErr) throw new Error(orderErr.message);

    const clientIds = Array.from(new Set((orders ?? []).map((o) => o.client_id).filter(Boolean)));
    const productIds = Array.from(new Set((orders ?? []).map((o) => o.product_id).filter(Boolean)));
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

    const assignMap = new Map((assignments ?? []).map((a) => [a.order_id, a]));
    const clientMap = new Map((clientsRes.data ?? []).map((c) => [c.id, c]));
    const productMap = new Map((productsRes.data ?? []).map((p) => [p.id, p]));

    return (orders ?? [])
      .map((o) => {
        const c = clientMap.get(o.client_id);
        const p = productMap.get(o.product_id);
        const a = assignMap.get(o.id);
        return {
          id: o.id,
          client_id: o.client_id,
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
          urgent_note: a?.note ?? null,
          assigned_at: a?.created_at ?? null,
        };
      })
      .sort((a, b) => {
        const da = a.assigned_at ? new Date(a.assigned_at).getTime() : 0;
        const dbv = b.assigned_at ? new Date(b.assigned_at).getTime() : 0;
        return dbv - da;
      });
  });

  return NextResponse.json({ rows }, { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } });
}
