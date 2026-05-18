import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Module-level cache: admin areas rarely change between page loads. Avoids
// hammering the orders table 20× on every admin page mount.
type CacheEntry = { value: { areas: string[]; label: string | null }; expiresAt: number };
const areaCache = new Map<string, CacheEntry>();
const AREA_CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Serve from cache when fresh — admin scope rarely changes mid-session.
  const cached = areaCache.get(user.id);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.value);
  }

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
    const value = { areas: [], label: "All areas" } as { areas: string[]; label: string | null };
    areaCache.set(user.id, { value, expiresAt: Date.now() + AREA_CACHE_TTL_MS });
    return NextResponse.json(value);
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
    const value = { areas, label } as { areas: string[]; label: string | null };
    areaCache.set(user.id, { value, expiresAt: Date.now() + AREA_CACHE_TTL_MS });
    return NextResponse.json(value);
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
    const value = { areas: [], label: "No area assigned" } as { areas: string[]; label: string | null };
    areaCache.set(user.id, { value, expiresAt: Date.now() + AREA_CACHE_TTL_MS });
    return NextResponse.json(value);
  }

  // Get the total count, then fetch pages in parallel instead of one at a time.
  const countRes = await db
    .from("orders")
    .select("branch", { count: "exact", head: true })
    .in("salesperson_id", salespersonIds)
    .not("branch", "is", null);
  const total = Math.min(Number(countRes.count ?? 0), 20_000);
  const PAGE = 1000;
  const CONCURRENCY = 8;
  const pages = total > 0 ? Math.ceil(total / PAGE) : 1;
  const pageIdxs = Array.from({ length: pages }, (_, i) => i);

  const seen = new Set<string>();
  const areas: string[] = [];
  for (let i = 0; i < pageIdxs.length; i += CONCURRENCY) {
    const slice = pageIdxs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map((idx) =>
        db
          .from("orders")
          .select("branch")
          .in("salesperson_id", salespersonIds)
          .not("branch", "is", null)
          .range(idx * PAGE, idx * PAGE + PAGE - 1)
      )
    );
    for (const r of results) {
      if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
      for (const row of r.data ?? []) {
        const raw = String((row as { branch?: string | null }).branch ?? "").trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        areas.push(raw);
      }
    }
  }

  areas.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const label = areas.length > 0
    ? areas.slice(0, 2).join(", ") + (areas.length > 2 ? ` +${areas.length - 2}` : "")
    : "No area assigned";
  const value = { areas, label } as { areas: string[]; label: string | null };
  areaCache.set(user.id, { value, expiresAt: Date.now() + AREA_CACHE_TTL_MS });
  return NextResponse.json(value);
}
