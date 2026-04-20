import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function GET() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });

  const { data: profile, error: profileErr } = await db
    .from("users")
    .select("id, role, is_super_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 });
  if (!profile || profile.role !== "admin") return NextResponse.json({ areas: [], label: null });

  if (Boolean((profile as { is_super_admin?: boolean | null }).is_super_admin ?? false)) {
    return NextResponse.json({ areas: [], label: "All areas" });
  }

  // Prefer explicit branch mapping from admin_branch_scope.
  const explicit = await db
    .from("admin_branch_scope")
    .select("branch_name")
    .eq("admin_user_id", user.id);
  if (!explicit.error && (explicit.data?.length ?? 0) > 0) {
    const areas = Array.from(
      new Set(
        (explicit.data ?? [])
          .map((r: { branch_name: string | null }) => String(r.branch_name ?? "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const label = areas.slice(0, 2).join(", ") + (areas.length > 2 ? ` +${areas.length - 2}` : "");
    return NextResponse.json({ areas, label });
  }

  const { data: scopeRows, error: scopeErr } = await db
    .from("admin_salesperson_scope")
    .select("salesperson_id")
    .eq("admin_user_id", user.id);
  if (scopeErr) return NextResponse.json({ error: scopeErr.message }, { status: 500 });

  const salespersonIds = (scopeRows ?? [])
    .map((r: { salesperson_id: string | null }) => r.salesperson_id)
    .filter((v: string | null): v is string => Boolean(v));
  if (salespersonIds.length === 0) {
    return NextResponse.json({ areas: [], label: "No area assigned" });
  }

  const seen = new Set<string>();
  const areas: string[] = [];
  const PAGE = 1000;
  let from = 0;
  while (from < 20_000) {
    const { data: rows, error } = await db
      .from("orders")
      .select("branch")
      .in("salesperson_id", salespersonIds)
      .not("branch", "is", null)
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!rows?.length) break;
    for (const row of rows) {
      const raw = String((row as { branch?: string | null }).branch ?? "").trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      areas.push(raw);
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  areas.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const label = areas.length > 0 ? areas.slice(0, 2).join(", ") + (areas.length > 2 ? ` +${areas.length - 2}` : "") : "No area assigned";
  return NextResponse.json({ areas, label });
}
