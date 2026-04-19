import { NextResponse } from "next/server";
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

/** Distinct branches with order counts and revenue (scans `orders.branch` in pages). */
export async function GET() {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });

  try {
    const rpc = await db.rpc("branch_order_stats" as never);
    if (!rpc.error && Array.isArray(rpc.data)) {
      const rows = (rpc.data as { branch: string; order_count: number; total_revenue: number }[]).map((r) => ({
        branch: r.branch === "" || r.branch == null ? null : r.branch,
        order_count: Number(r.order_count) || 0,
        total_revenue: Number(r.total_revenue) || 0,
      }));
      return NextResponse.json({ branches: rows }, { headers: { "Cache-Control": "no-store, private" } });
    }
  } catch {
    // fall through to chunked scan
  }

  const counts = new Map<string, { n: number; rev: number }>();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await db.from("orders").select("branch, invoice_total").range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) break;
    for (const row of data) {
      const b = (row.branch as string | null)?.trim() ?? "";
      const key = b || "__none__";
      const prev = counts.get(key) ?? { n: 0, rev: 0 };
      prev.n += 1;
      prev.rev += Number((row as { invoice_total?: number }).invoice_total) || 0;
      counts.set(key, prev);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const branches = Array.from(counts.entries())
    .map(([key, v]) => ({
      branch: key === "__none__" ? null : key,
      order_count: v.n,
      total_revenue: v.rev,
    }))
    .sort((a, b) => b.order_count - a.order_count);

  return NextResponse.json({ branches }, { headers: { "Cache-Control": "no-store, private" } });
}
