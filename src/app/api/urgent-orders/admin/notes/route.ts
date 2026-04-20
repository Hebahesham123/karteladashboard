import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { invalidateServerCache } from "@/lib/serverResponseCache";
import { canAccessSalesperson, resolveAdminScope } from "@/lib/adminScope";

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

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });
  let scope;
  try {
    scope = await resolveAdminScope(db, admin.userId);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Forbidden";
    const status = msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }

  const orderId = req.nextUrl.searchParams.get("orderId");
  if (!orderId) return NextResponse.json({ error: "orderId is required" }, { status: 400 });

  const { data: orderRow, error: orderErr } = await db
    .from("orders")
    .select("id, client_id, salesperson_id")
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });
  if (!orderRow || !canAccessSalesperson(scope, String(orderRow.salesperson_id ?? ""))) {
    return NextResponse.json({ error: "Forbidden for this order" }, { status: 403 });
  }

  const { data: orderLogs, error: orderLogsErr } = await db
    .from("activity_logs")
    .select("id, user_id, metadata, created_at")
    .eq("activity_type", "NOTE_ADDED")
    .eq("entity_type", "order")
    .eq("entity_id", orderId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (orderLogsErr) return NextResponse.json({ error: orderLogsErr.message }, { status: 500 });

  let logs = orderLogs ?? [];
  // Backward compatibility: old notes may have been written as client notes.
  if (logs.length === 0 && orderRow?.client_id) {
    const { data: clientLogs, error: clientLogsErr } = await db
      .from("activity_logs")
      .select("id, user_id, metadata, created_at")
      .eq("activity_type", "NOTE_ADDED")
      .eq("entity_type", "client")
      .eq("entity_id", orderRow.client_id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (clientLogsErr) return NextResponse.json({ error: clientLogsErr.message }, { status: 500 });
    logs = clientLogs ?? [];
  }

  const raw = logs.map((r: any) => ({
    id: String(r.id),
    user_id: r.user_id ? String(r.user_id) : null,
    note: String(r?.metadata?.note ?? "").trim(),
    created_at: String(r.created_at),
  })).filter((r) => r.note.length > 0);

  const userIds = Array.from(new Set(raw.map((r) => r.user_id).filter(Boolean))) as string[];
  let names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await db.from("users").select("id, full_name").in("id", userIds);
    names = new Map((users ?? []).map((u: any) => [String(u.id), String(u.full_name ?? "—")]));
  }

  const history = raw.map((entry) => ({
    id: entry.id,
    note: entry.note,
    created_at: entry.created_at,
    user_name: entry.user_id ? names.get(entry.user_id) ?? "—" : "—",
  }));
  return NextResponse.json({ history });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });
  let scope;
  try {
    scope = await resolveAdminScope(db, admin.userId);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Forbidden";
    const status = msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }

  const body = (await req.json()) as {
    orderId?: string;
    note?: string;
    clientName?: string;
  };
  const orderId = (body.orderId ?? "").trim();
  const note = (body.note ?? "").trim();
  if (!orderId || !note) return NextResponse.json({ error: "orderId and note are required" }, { status: 400 });
  const { data: orderRow, error: orderErr } = await db
    .from("orders")
    .select("id, salesperson_id")
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });
  if (!orderRow || !canAccessSalesperson(scope, String(orderRow.salesperson_id ?? ""))) {
    return NextResponse.json({ error: "Forbidden for this order" }, { status: 403 });
  }

  const { error } = await db.from("activity_logs").insert({
    user_id: admin.userId,
    activity_type: "NOTE_ADDED",
    entity_type: "order",
    entity_id: orderId,
    description: `Added note on urgent order${body.clientName ? ` (${body.clientName})` : ""}`,
    metadata: { note, order_id: orderId, scope: "urgent_order" },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  invalidateServerCache("urgent-admin:rows:");
  invalidateServerCache("urgent-my:");
  return NextResponse.json({ ok: true });
}
