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

  const orderId = req.nextUrl.searchParams.get("orderId");
  const salespersonId = req.nextUrl.searchParams.get("salespersonId");
  if (!orderId) return NextResponse.json({ error: "orderId is required" }, { status: 400 });

  const { data: orderRow, error: orderErr } = await db
    .from("orders")
    .select(
      "client_id, product_id, salesperson_id, invoice_ref, branch, month, year, invoice_date, quantity, invoice_total, meter_breakdown, category, pricelist, created_at"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });
  if (!orderRow) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const clientId = orderRow.client_id as string | null;
  const productId = orderRow.product_id as string | null;
  const spId = orderRow.salesperson_id as string | null;

  const [clientRes, productRes, spRes] = await Promise.all([
    clientId
      ? db.from("clients").select("name, partner_id, current_status, notes").eq("id", clientId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    productId
      ? db.from("products").select("name").eq("id", productId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    spId
      ? db.from("salespersons").select("code, name").eq("id", spId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (clientRes.error) return NextResponse.json({ error: clientRes.error.message }, { status: 500 });
  if (productRes.error) return NextResponse.json({ error: productRes.error.message }, { status: 500 });
  if (spRes.error) return NextResponse.json({ error: spRes.error.message }, { status: 500 });

  type AssignmentRow = { is_active: boolean; note: string | null; client_status: string | null };
  let assignment: AssignmentRow | null = null;
  if (salespersonId) {
    const res = await db
      .from("urgent_order_assignments")
      .select("is_active, note, client_status")
      .eq("order_id", orderId)
      .eq("salesperson_id", salespersonId)
      .maybeSingle();
    if (res.error && String(res.error.message ?? "").includes("client_status")) {
      const fb = await db
        .from("urgent_order_assignments")
        .select("is_active, note")
        .eq("order_id", orderId)
        .eq("salesperson_id", salespersonId)
        .maybeSingle();
      if (fb.error) return NextResponse.json({ error: fb.error.message }, { status: 500 });
      if (fb.data) assignment = { ...(fb.data as { is_active: boolean; note: string | null }), client_status: null };
    } else {
      if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
      if (res.data) assignment = res.data as AssignmentRow;
    }
  }

  const order = {
    invoice_ref: orderRow.invoice_ref,
    branch: orderRow.branch,
    month: orderRow.month,
    year: orderRow.year,
    invoice_date: (orderRow as { invoice_date?: string | null }).invoice_date ?? null,
    quantity: (orderRow as { quantity?: number }).quantity ?? 0,
    invoice_total: (orderRow as { invoice_total?: number }).invoice_total ?? 0,
    category: (orderRow as { category?: string | null }).category ?? null,
    pricelist: (orderRow as { pricelist?: string | null }).pricelist ?? null,
    meter_breakdown: (orderRow as { meter_breakdown?: unknown }).meter_breakdown ?? null,
    created_at: (orderRow as { created_at?: string }).created_at ?? null,
  };

  return NextResponse.json(
    {
      order,
      client: clientRes.data,
      product: productRes.data,
      salesperson: spRes.data,
      assignment,
    },
    { headers: { "Cache-Control": "no-store, private" } }
  );
}
