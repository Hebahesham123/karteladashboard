import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAdminBranchScope, resolveAdminScope } from "@/lib/adminScope";
import { ALLOWED_CUSTOMER_TYPES } from "@/lib/customerTypes";

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

const PAGE = 1000;

/** Distinct clients that ever ordered from the given branches (all months). */
async function countClientsInBranches(
  db: any,
  branches: string[],
  types: string[],
  salespersonId: string | null,
): Promise<number> {
  const build = (head: boolean) => {
    let q = head
      ? db.from("client_monthly_metrics").select("client_id", { count: "exact", head: true })
      : db.from("client_monthly_metrics").select("client_id");
    q = q.in("order_import_branch", branches).in("customer_type", types);
    if (salespersonId) q = q.eq("salesperson_id", salespersonId);
    return q;
  };

  const { count, error: countErr } = await build(true);
  if (countErr) throw new Error(countErr.message);
  const total = Math.max(0, Number(count ?? 0));
  if (total === 0) return 0;

  // Page in parallel — a branch group can span tens of thousands of rows and a
  // serial walk pushed this past 10s.
  const seen = new Set<string>();
  const pages = Math.ceil(total / PAGE);
  const CONCURRENCY = 8;
  for (let i = 0; i < pages; i += CONCURRENCY) {
    const slice = Array.from({ length: Math.min(CONCURRENCY, pages - i) }, (_, j) => i + j);
    const results = await Promise.all(
      slice.map((idx) => build(false).range(idx * PAGE, idx * PAGE + PAGE - 1)),
    );
    for (const r of results) {
      if (r.error) throw new Error(r.error.message);
      for (const row of r.data ?? []) {
        const id = String((row as { client_id?: string | null }).client_id ?? "");
        if (id) seen.add(id);
      }
    }
  }
  return seen.size;
}

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });

  const url = new URL(req.url);
  const salespersonId = String(url.searchParams.get("salesperson") ?? "").trim() || null;
  const requestedBranches = (url.searchParams.get("branches") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
