import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type EventType = "login" | "logout";

function pickIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return null;
}

export async function POST(req: Request) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { event?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* empty body is fine */
  }

  const event = body.event as EventType | undefined;
  if (event !== "login" && event !== "logout") {
    return NextResponse.json({ error: "Invalid event; expected 'login' or 'logout'" }, { status: 400 });
  }

  const ip = pickIp(req);
  const userAgent = req.headers.get("user-agent") ?? null;

  const { error } = await supabase.from("auth_events").insert({
    user_id: user.id,
    email: user.email ?? "",
    event,
    ip,
    user_agent: userAgent,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  const eventFilter = url.searchParams.get("event");
  const emailFilter = url.searchParams.get("email")?.trim().toLowerCase();

  let q = supabase
    .from("auth_events")
    .select("id, user_id, email, event, ip, user_agent, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (eventFilter === "login" || eventFilter === "logout") {
    q = q.eq("event", eventFilter);
  }
  if (emailFilter) {
    q = q.ilike("email", `%${emailFilter}%`);
  }

  const { data, error, count } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ events: data ?? [], total: count ?? 0, limit, offset });
}
