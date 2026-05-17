import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });

  const { data: profile } = await db
    .from("users")
    .select("id, role, is_super_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!Boolean((profile as { is_super_admin?: boolean | null }).is_super_admin ?? false)) {
    return NextResponse.json({ error: "Forbidden: super admin only" }, { status: 403 });
  }

  const { data: admins, error: adminErr } = await (db as any)
    .from("users")
    .select("id, full_name, email, is_active, is_super_admin")
    .eq("role", "admin")
    .order("full_name", { ascending: true });
  if (adminErr) return NextResponse.json({ error: adminErr.message }, { status: 500 });

  const { data: scopeRows, error: scopeErr } = await (db as any)
    .from("admin_branch_scope")
    .select("admin_user_id, branch_name");
  if (scopeErr) return NextResponse.json({ error: scopeErr.message }, { status: 500 });

  // Pull auth user_metadata for titles (مدير فرع / نائب مدير فرع).
  const titleByUser = new Map<string, string>();
  try {
    let page = 1;
    for (;;) {
      const listed = await (db as any).auth.admin.listUsers({ page, perPage: 1000 });
      const users = listed.data?.users ?? [];
      for (const u of users) {
        const t = String(u?.user_metadata?.title ?? "").trim();
        if (t) titleByUser.set(u.id, t);
      }
      if (users.length < 1000) break;
      page += 1;
      if (page > 20) break;
    }
  } catch {
    // ignore — title is optional
  }

  const branchesByUser = new Map<string, string[]>();
  for (const r of (scopeRows ?? []) as { admin_user_id: string; branch_name: string | null }[]) {
    const uid = r.admin_user_id;
    const b = String(r.branch_name ?? "").trim();
    if (!uid || !b) continue;
    if (!branchesByUser.has(uid)) branchesByUser.set(uid, []);
    branchesByUser.get(uid)!.push(b);
  }

  type Row = {
    user_id: string;
    full_name: string;
    email: string;
    title: string | null;
    type: "branch_manager" | "area_manager";
    branches: string[];
    is_active: boolean;
  };

  const out: Row[] = [];
  for (const u of (admins ?? []) as {
    id: string;
    full_name: string | null;
    email: string | null;
    is_active: boolean | null;
    is_super_admin: boolean | null;
  }[]) {
    if (Boolean(u.is_super_admin)) continue;
    const branches = (branchesByUser.get(u.id) ?? [])
      .map((b) => b.trim())
      .filter(Boolean);
    if (branches.length === 0) continue;
    const uniq = Array.from(new Set(branches)).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    out.push({
      user_id: u.id,
      full_name: String(u.full_name ?? "").trim() || String(u.email ?? "").trim(),
      email: String(u.email ?? "").trim(),
      title: titleByUser.get(u.id) ?? null,
      type: uniq.length >= 2 ? "area_manager" : "branch_manager",
      branches: uniq,
      is_active: Boolean(u.is_active),
    });
  }

  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === "area_manager" ? -1 : 1;
    return a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base" });
  });

  return NextResponse.json({ managers: out });
}
