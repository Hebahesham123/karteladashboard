import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAdminBranchScope, resolveAdminScope } from "@/lib/adminScope";
import { canonicalizeBranch, expandBranchScopeForFilter } from "@/lib/branchAliases";

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
  const canonicalScope = (branchScope?.branches ?? [])
    .map((b) => canonicalizeBranch(b))
    .filter(Boolean);
  const allowedCanonical = new Set(canonicalScope);
  const hasBranchScope = allowedCanonical.size > 0;
  const hasSalesScope = !adminScope.isSuperAdmin && adminScope.salespersonIds.length > 0;

  // Helper: collapse a list of (potentially aliased) DB branch strings into canonical groups.
  const groupByCanonical = (rows: { branch: string | null; order_count: number; total_revenue: number }[]) => {
    const merged = new Map<string, { order_count: number; total_revenue: number }>();
    for (const r of rows) {
      const canonical = r.branch ? canonicalizeBranch(r.branch) : "";
      if (!adminScope.isSuperAdmin && hasBranchScope && !allowedCanonical.has(canonical)) continue;
      const key = canonical || "__none__";
      const prev = merged.get(key) ?? { order_count: 0, total_revenue: 0 };
      prev.order_count += Number(r.order_count) || 0;
      prev.total_revenue += Number(r.total_revenue) || 0;
      merged.set(key, prev);
    }
    return merged;
  };

  // Fast path: server-side GROUP BY via RPCs. Returns ~33 rows total,
  // microseconds on the DB side instead of streaming individual orders.
  try {
    let rpc;
    if (adminScope.isSuperAdmin) {
      rpc = await db.rpc("branch_order_stats" as never);
    } else if (hasSalesScope) {
      rpc = await db.rpc("branch_order_stats_for_salespersons" as never, {
        p_sp_ids: adminScope.salespersonIds,
      } as never);
    }
    if (rpc && !rpc.error && Array.isArray(rpc.data)) {
      const merged = groupByCanonical(
        (rpc.data as { branch: string; order_count: number; total_revenue: number }[]).map((r) => ({
          branch: r.branch === "" || r.branch == null ? null : r.branch,
          order_count: Number(r.order_count) || 0,
          total_revenue: Number(r.total_revenue) || 0,
        }))
      );
      // Ensure scoped admins always see their full branch list even if zero orders.
      if (!adminScope.isSuperAdmin && hasBranchScope) {
        for (const b of canonicalScope) {
          if (!merged.has(b)) merged.set(b, { order_count: 0, total_revenue: 0 });
        }
      }
      const rows = Array.from(merged.entries())
        .map(([key, v]) => ({
          branch: key === "__none__" ? null : key,
          order_count: v.order_count,
          total_revenue: v.total_revenue,
        }))
        .sort((a, b) => b.order_count - a.order_count);
      return NextResponse.json(
        { branches: rows },
        { headers: { "Cache-Control": "private, max-age=60" } }
      );
    }
  } catch {
    // fall through to chunked scan
  }

  // Push down every filter we can server-side. Expand the scoped admin's
  // branch list to include every known Arabic/English/spelling variant so the
  // IN-list hits the real values in orders.branch.
  const expandedBranchFilter = hasBranchScope
    ? expandBranchScopeForFilter(canonicalScope)
    : [];
  const applyFilters = <T extends { in: any }>(q: T): T => {
    let r: any = q;
    if (!adminScope.isSuperAdmin && hasSalesScope) r = r.in("salesperson_id", adminScope.salespersonIds);
    if (!adminScope.isSuperAdmin && expandedBranchFilter.length > 0) {
      r = r.in("branch", expandedBranchFilter);
    }
    return r as T;
  };

  // Count first, then fetch pages in parallel.
  const countRes = await applyFilters(
    db.from("orders").select("branch", { count: "exact", head: true })
  );
  if (countRes.error) {
    return NextResponse.json({ error: countRes.error.message }, { status: 500 });
  }
  const totalRows = Math.max(0, Number(countRes.count ?? 0));

  const counts = new Map<string, { n: number; rev: number }>();
  const PAGE = 1000;
  const CONCURRENCY = 10;
  const pages = totalRows > 0 ? Math.ceil(totalRows / PAGE) : 0;

  for (let i = 0; i < pages; i += CONCURRENCY) {
    const slice = Array.from(
      { length: Math.min(CONCURRENCY, pages - i) },
      (_, j) => i + j,
    );
    const results = await Promise.all(
      slice.map((idx) =>
        applyFilters(db.from("orders").select("branch, invoice_total")).range(
          idx * PAGE,
          idx * PAGE + PAGE - 1,
        ),
      ),
    );
    for (const r of results) {
      if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
      for (const row of r.data ?? []) {
        const raw = (row.branch as string | null)?.trim() ?? "";
        const canonical = canonicalizeBranch(raw);
        if (!adminScope.isSuperAdmin && hasBranchScope && !allowedCanonical.has(canonical)) continue;
        const key = canonical || "__none__";
        const prev = counts.get(key) ?? { n: 0, rev: 0 };
        prev.n += 1;
        prev.rev += Number((row as { invoice_total?: number }).invoice_total) || 0;
        counts.set(key, prev);
      }
    }
  }

  // Ensure scoped admins always see their full assigned branch list (canonical names),
  // even when a branch has zero orders in the current dataset.
  if (!adminScope.isSuperAdmin && hasBranchScope) {
    for (const b of canonicalScope) {
      if (!counts.has(b)) counts.set(b, { n: 0, rev: 0 });
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
