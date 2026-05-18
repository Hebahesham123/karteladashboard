export type AdminScope = {
  isSuperAdmin: boolean;
  salespersonIds: string[];
};
export type AdminBranchScope = {
  branches: string[];
};

function isMissingColumnOrTable(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("does not exist") || m.includes("column") || m.includes("relation");
}

/**
 * Resolves admin scope from DB.
 * Backward compatible: if scope schema is not deployed yet, behaves as super-admin.
 */
export async function resolveAdminScope(db: any, userId: string): Promise<AdminScope> {
  const base = await db.from("users").select("role, is_super_admin").eq("id", userId).maybeSingle();
  if (base.error) {
    if (!isMissingColumnOrTable(String(base.error.message ?? ""))) {
      throw new Error(base.error.message);
    }
    const fallback = await db.from("users").select("role").eq("id", userId).maybeSingle();
    if (fallback.error) throw new Error(fallback.error.message);
    if (!fallback.data || fallback.data.role !== "admin") throw new Error("Forbidden");
    return { isSuperAdmin: true, salespersonIds: [] };
  }

  if (!base.data || base.data.role !== "admin") throw new Error("Forbidden");
  const isSuperAdmin = Boolean((base.data as { is_super_admin?: boolean | null }).is_super_admin ?? false);
  if (isSuperAdmin) return { isSuperAdmin: true, salespersonIds: [] };

  const scopeRes = await db
    .from("admin_salesperson_scope")
    .select("salesperson_id")
    .eq("admin_user_id", userId);

  if (scopeRes.error) {
    if (!isMissingColumnOrTable(String(scopeRes.error.message ?? ""))) {
      throw new Error(scopeRes.error.message);
    }
    return { isSuperAdmin: true, salespersonIds: [] };
  }

  const salespersonIds = (scopeRes.data ?? [])
    .map((r: { salesperson_id: string | null }) => r.salesperson_id)
    .filter((v: string | null): v is string => Boolean(v));
  if (salespersonIds.length > 0) {
    return { isSuperAdmin: false, salespersonIds };
  }

  // Fallback: derive scope from explicit admin_branch_scope by matching orders.branch.
  const branchRes = await db.from("admin_branch_scope").select("branch_name").eq("admin_user_id", userId);
  if (branchRes.error) {
    if (!isMissingColumnOrTable(String(branchRes.error.message ?? ""))) {
      throw new Error(branchRes.error.message);
    }
    return { isSuperAdmin: false, salespersonIds: [] };
  }
  const aliasNames = (branchRes.data ?? [])
    .map((r: { branch_name: string | null }) => String(r.branch_name ?? "").trim())
    .filter(Boolean);
  if (aliasNames.length === 0) {
    return { isSuperAdmin: false, salespersonIds: [] };
  }

  // Expand admin_branch_scope aliases to actual orders.branch values via branch_aliases.
  const actualBranches = new Set<string>();
  try {
    const aliasRes = await db
      .from("branch_aliases")
      .select("alias_name, actual_branches")
      .in("alias_name", aliasNames);
    if (aliasRes.error && !isMissingColumnOrTable(String(aliasRes.error.message ?? ""))) {
      throw new Error(aliasRes.error.message);
    }
    const aliasMap = new Map<string, string[]>();
    for (const row of aliasRes.data ?? []) {
      const r = row as { alias_name?: string | null; actual_branches?: string[] | null };
      const k = String(r.alias_name ?? "").trim().toLowerCase();
      if (!k) continue;
      const arr = Array.isArray(r.actual_branches)
        ? r.actual_branches.map((x) => String(x ?? "").trim()).filter(Boolean)
        : [];
      aliasMap.set(k, arr);
    }
    for (const alias of aliasNames) {
      const mapped = aliasMap.get(alias.toLowerCase());
      if (mapped && mapped.length > 0) {
        for (const m of mapped) actualBranches.add(m);
      } else {
        actualBranches.add(alias);
      }
    }
  } catch {
    for (const a of aliasNames) actualBranches.add(a);
  }

  const ids = new Set<string>();
  // Use exact match (branch IN actual) — aliases already expand to the literal Arabic names in orders.branch.
  const actualList = Array.from(actualBranches);
  if (actualList.length > 0) {
    const PAGE = 5000;
    let from = 0;
    for (;;) {
      const { data, error } = await db
        .from("orders")
        .select("salesperson_id")
        .in("branch", actualList)
        .not("salesperson_id", "is", null)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      for (const row of data) {
        const sid = String((row as { salesperson_id?: string | null }).salesperson_id ?? "").trim();
        if (sid) ids.add(sid);
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  return { isSuperAdmin: false, salespersonIds: Array.from(ids) };
}

export function canAccessSalesperson(scope: AdminScope, salespersonId: string): boolean {
  if (scope.isSuperAdmin) return true;
  if (!salespersonId) return false;
  return scope.salespersonIds.includes(salespersonId);
}

export function filterSalespersonsByScope<T extends { id: string }>(scope: AdminScope, rows: T[]): T[] {
  if (scope.isSuperAdmin) return rows;
  const allowed = new Set(scope.salespersonIds);
  return rows.filter((r) => allowed.has(r.id));
}

export async function resolveAdminBranchScope(db: any, userId: string): Promise<AdminBranchScope> {
  const res = await db.from("admin_branch_scope").select("branch_name").eq("admin_user_id", userId);
  if (res.error) {
    if (!isMissingColumnOrTable(String(res.error.message ?? ""))) {
      throw new Error(res.error.message);
    }
    return { branches: [] };
  }
  const aliasNames: string[] = [];
  const seenAlias = new Set<string>();
  for (const row of res.data ?? []) {
    const b = String((row as { branch_name?: string | null }).branch_name ?? "").trim();
    if (!b) continue;
    const k = b.toLowerCase();
    if (seenAlias.has(k)) continue;
    seenAlias.add(k);
    aliasNames.push(b);
  }
  if (aliasNames.length === 0) return { branches: [] };

  // Expand aliases via branch_aliases → actual branch values found in orders.branch.
  // If the aliases table is missing or has no row for an alias, fall back to the alias literal.
  const expanded = new Set<string>();
  try {
    const aliasRes = await db
      .from("branch_aliases")
      .select("alias_name, actual_branches")
      .in("alias_name", aliasNames);
    if (aliasRes.error && !isMissingColumnOrTable(String(aliasRes.error.message ?? ""))) {
      throw new Error(aliasRes.error.message);
    }
    const aliasMap = new Map<string, string[]>();
    for (const row of aliasRes.data ?? []) {
      const r = row as { alias_name?: string | null; actual_branches?: string[] | null };
      const k = String(r.alias_name ?? "").trim().toLowerCase();
      if (!k) continue;
      const arr = Array.isArray(r.actual_branches)
        ? r.actual_branches.map((x) => String(x ?? "").trim()).filter(Boolean)
        : [];
      aliasMap.set(k, arr);
    }
    for (const alias of aliasNames) {
      const mapped = aliasMap.get(alias.toLowerCase());
      if (mapped && mapped.length > 0) {
        for (const m of mapped) expanded.add(m);
      } else {
        // No alias mapping — assume the value is already an actual branch.
        expanded.add(alias);
      }
    }
  } catch {
    // If branch_aliases table cannot be read, fall back to raw values so we never silently lock the user out.
    for (const a of aliasNames) expanded.add(a);
  }

  return { branches: Array.from(expanded) };
}
