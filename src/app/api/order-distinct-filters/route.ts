import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import {
  fetchDistinctCategoriesAndPricelists,
  fetchClientIdsForSalesperson,
  fetchDistinctFromOrdersForClients,
} from "@/lib/orderImportMeta";
import { getOrSetServerCache } from "@/lib/serverResponseCache";

/**
 * Distinct order.category / order.pricelist for the selected calendar month.
 * Uses service role after session check so lists are complete (RLS no longer hides rows).
 * Admin: all orders in month. Sales: only orders for clients assigned to that rep.
 */
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error: profileErr } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr || !profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 403 });
  }

  const m = parseInt(req.nextUrl.searchParams.get("month") || "", 10);
  const y = parseInt(req.nextUrl.searchParams.get("year") || "", 10);
  if (m < 1 || m > 12 || y < 2000 || y > 2100) {
    return NextResponse.json({ error: "Invalid month or year" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "Server missing Supabase URL or SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (profile.role === "admin") {
    const r = await getOrSetServerCache(
      `order-distinct:admin:${m}:${y}`,
      60_000,
      () => fetchDistinctCategoriesAndPricelists(admin, { month: m, year: y, maxPages: 500 })
    );
    return NextResponse.json(r);
  }

  if (profile.role === "sales") {
    const { data: sp } = await admin.from("salespersons").select("id").eq("user_id", user.id).maybeSingle();
    if (!sp?.id) {
      return NextResponse.json({ categories: [], pricelists: [], error: null });
    }
    const { ids, error: idErr } = await fetchClientIdsForSalesperson(admin, sp.id as string);
    if (idErr) {
      return NextResponse.json({ categories: [], pricelists: [], error: idErr });
    }
    const r = await getOrSetServerCache(
      `order-distinct:sales:${user.id}:${m}:${y}`,
      60_000,
      () => fetchDistinctFromOrdersForClients(admin, ids, m, y)
    );
    return NextResponse.json(r);
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
