import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAdminBranchScope, resolveAdminScope } from "@/lib/adminScope";

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
  let adminScope;
  let branchScope;
  try {
    adminScope = await resolveAdminScope(db, admin.userId);
    branchScope = await resolveAdminBranchScope(db, admin.userId);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Forbidden";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 500 });
  }
  const allowedBranches = new Set((branchScope?.branches ?? []).map((b) => b.toLowerCase()));
  const hasBranchScope = allowedBranches.size > 0;
  const hasSalesScope = !adminScope.isSuperAdmin && adminScope.salespersonIds.length > 0;

  if (adminScope.isSuperAdmin) {
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
  }

  const counts = new Map<string, { n: number; rev: number }>();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    let q = db.from("orders").select("branch, invoice_total, salesperson_id").range(from, from + PAGE - 1);
    if (!adminScope.isSuperAdmin && hasSalesScope) q = q.in("salesperson_id", adminScope.salespersonIds);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) break;
    for (const row of data) {
      const b = (row.branch as string | null)?.trim() ?? "";
      if (!adminScope.isSuperAdmin && hasBranchScope && !allowedBranches.has(b.toLowerCase())) continue;
      const key = b || "__none__";
      const prev = counts.get(key) ?? { n: 0, rev: 0 };
      prev.n += 1;
      prev.rev += Number((row as { invoice_total?: number }).invoice_total) || 0;
      counts.set(key, prev);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // Ensure scoped admins always see their full assigned branch list,
  // even when a branch has zero orders in the current dataset.
  if (!adminScope.isSuperAdmin && hasBranchScope) {
    for (const b of branchScope.branches ?? []) {
      const clean = String(b ?? "").trim();
      if (!clean) continue;
      const key = clean;
      if (!counts.has(key)) {
        counts.set(key, { n: 0, rev: 0 });
      }
    }
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
