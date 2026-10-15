import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAdminBranchScope, resolveAdminScope } from "@/lib/adminScope";
import { ALLOWED_CUSTOMER_TYPES } from "@/lib/customerTypes";
import { canonicalizeBranchList, expandBranchScopeForFilter } from "@/lib/branchAliases";

export const dynamic = "force-dynamic";

/**
 * Total clients in the caller's scope — the denominator behind the dashboard's
 * "Dormant" tile (total clients − clients active this month).
 *
 * Why this lives on the server: querying `clients` with count:exact from the
 * browser goes through RLS, and the scoped-admin policy checks
 * `EXISTS (SELECT 1 FROM orders WHERE client_id = clients.id AND admin_has_branch(...))`
 * for every row. For branch-scoped admins that returns 0 (and takes ~50s), so
 * the dashboard computed max(0, 0 − activeClients) = 0 and Dormant was always
 * empty. Here we use the service role and apply the admin's scope explicitly.
 */

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

type CacheEntry = { value: { total: number; basis: string }; expiresAt: number };
const countCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Distinct clients that ever ordered from the given branches (all months). */
async function countClientsInBranches(
  db: any,
  branches: string[],
  types: string[],
  salespersonId: string | null,
): Promise<number> {
  /* Count the distinct clients in Postgres instead of shipping every row here.
   *
   * get_dashboard_kpis already groups by client_id and returns the group count,
   * so an all-time range with the same branch / type / salesperson filters is
   * exactly this number. Two reasons to prefer it over paging:
   *
   *   Correct — the old loop called .range() with no .order(). Postgres gives
   *   no ordering guarantee without ORDER BY, so paged reads could repeat and
   *   skip rows; measured against these two branches it returned 583 where the
   *   real answer is 1197.
   *
   *   Fast — up to 48k rows crossed the wire to be de-duplicated in JS. The
   *   aggregate answers in ~300ms; the all-branches case went 10.5s -> 0.6s. */
  const { data, error } = await db.rpc("get_dashboard_kpis", {
    p_from_year: 2000,
    p_from_month: 1,
    p_to_year: 2100,
    p_to_month: 12,
    p_salesperson: salespersonId,
    p_branches: expandBranchScopeForFilter(branches),
    p_cust_types: types,
  });
  if (error) throw new Error(error.message);
  return Math.max(0, Number((data as { clientCount?: number } | null)?.clientCount ?? 0));
}

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  // Distinguish "could not verify" from "not signed in". When Supabase is
  // unreachable or slow, getUser() comes back with an error and no user, and
  // reporting that as 401 made load problems look like everyone being logged
  // out — the symptom that sent us hunting an auth bug for an hour.
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    return NextResponse.json({ error: "Could not verify session: " + authError.message }, { status: 503 });
  }
  const user = authData.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });

  const url = new URL(req.url);
  const salespersonId = String(url.searchParams.get("salesperson") ?? "").trim() || null;
  // Canonicalize so the intersection with the admin's scope below compares
  // like with like, whatever spelling the caller sent.
  const requestedBranches = canonicalizeBranchList(
    (url.searchParams.get("branches") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  );
  const requestedTypes = (url.searchParams.get("types") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((t) => (ALLOWED_CUSTOMER_TYPES as readonly string[]).includes(t));
  const types = requestedTypes.length > 0 ? requestedTypes : [...ALLOWED_CUSTOMER_TYPES];

  const cacheKey = [
    user.id,
    salespersonId ?? "-",
    requestedBranches.slice().sort().join("|"),
    types.slice().sort().join("|"),
  ].join("::");
  const cached = countCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.value);

  let scope;
  let branchScope;
  try {
    scope = await resolveAdminScope(db, user.id);
    branchScope = await resolveAdminBranchScope(db, user.id);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Forbidden";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 500 });
  }

  // Hard ceiling from the admin's own branch scope, intersected with whatever
  // branches were picked in the dashboard filter.
  const scopeBranches = scope.isSuperAdmin ? [] : branchScope.branches;
  let effectiveBranches: string[];
  if (scopeBranches.length === 0) {
    effectiveBranches = requestedBranches;
  } else if (requestedBranches.length === 0) {
    effectiveBranches = scopeBranches;
  } else {
    const allowed = new Set(scopeBranches);
    effectiveBranches = requestedBranches.filter((b) => allowed.has(b));
    // Picked branches all outside the admin's scope → nothing is in scope.
    if (effectiveBranches.length === 0) {
      const value = { total: 0, basis: "branch-scope-empty" };
      countCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return NextResponse.json(value);
    }
  }

  try {
    if (effectiveBranches.length > 0) {
      const total = await countClientsInBranches(db, effectiveBranches, types, salespersonId);
      const value = { total, basis: "branch-metrics" };
      countCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return NextResponse.json(value);
    }

    let q = db.from("clients").select("id", { count: "exact", head: true }).in("customer_type", types);
    if (salespersonId) q = q.eq("salesperson_id", salespersonId);
    if (!scope.isSuperAdmin && scope.salespersonIds.length > 0) {
      q = q.in("salesperson_id", scope.salespersonIds);
    }
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    const value = { total: Math.max(0, Number(count ?? 0)), basis: "clients" };
    countCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(value);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to count clients";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
