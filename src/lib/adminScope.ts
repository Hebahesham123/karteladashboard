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
  const branches = (branchRes.data ?? [])
    .map((r: { branch_name: string | null }) => String(r.branch_name ?? "").trim())
    .filter(Boolean);
  if (branches.length === 0) {
    return { isSuperAdmin: false, salespersonIds: [] };
  }

  const ids = new Set<string>();
  for (const b of branches) {
    const { data, error } = await db
      .from("orders")
      .select("salesperson_id")
      .ilike("branch", `%${b}%`)
      .not("salesperson_id", "is", null)
      .limit(5000);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const sid = String((row as { salesperson_id?: string | null }).salesperson_id ?? "").trim();
      if (sid) ids.add(sid);
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
  const seen = new Set<string>();
  const branches: string[] = [];
  for (const row of res.data ?? []) {
    const b = String((row as { branch_name?: string | null }).branch_name ?? "").trim();
    if (!b) continue;
    const k = b.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    branches.push(b);
  }
  return { branches };
}
