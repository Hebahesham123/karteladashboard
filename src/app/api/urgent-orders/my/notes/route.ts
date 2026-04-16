import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { invalidateServerCache } from "@/lib/serverResponseCache";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function requireSalesUser() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: profile } = await supabase.from("users").select("id, role, full_name").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== "sales") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { userId: user.id, fullName: profile.full_name ?? "—" };
}

async function getSalespersonId(db: any, userId: string) {
  const { data: sp } = await db.from("salespersons").select("id").eq("user_id", userId).maybeSingle();
  return (sp as { id?: string } | null)?.id ?? null;
}

async function validateAssignment(db: any, orderId: string, salespersonId: string) {
  const { data: assignment, error } = await db
    .from("urgent_order_assignments")
    .select("id")
    .eq("order_id", orderId)
    .eq("salesperson_id", salespersonId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(assignment?.id);
}

export async function GET(req: NextRequest) {
  const sales = await requireSalesUser();
  if ("error" in sales) return sales.error;
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });

  const orderId = req.nextUrl.searchParams.get("orderId");
  if (!orderId) return NextResponse.json({ error: "orderId is required" }, { status: 400 });

  const salespersonId = await getSalespersonId(db, sales.userId);
  if (!salespersonId) return NextResponse.json({ error: "Salesperson not linked" }, { status: 403 });

  const canAccess = await validateAssignment(db, orderId, salespersonId);
  if (!canAccess) return NextResponse.json({ error: "Not assigned to this order" }, { status: 403 });

  const { data: logs, error } = await db
    .from("activity_logs")
    .select("id, user_id, metadata, created_at")
    .eq("activity_type", "NOTE_ADDED")
    .eq("entity_type", "order")
    .eq("entity_id", orderId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const raw = (logs ?? []).map((r: any) => ({
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
  const sales = await requireSalesUser();
  if ("error" in sales) return sales.error;
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });

  const body = (await req.json()) as {
    orderId?: string;
    note?: string;
    clientName?: string;
  };
  const orderId = (body.orderId ?? "").trim();
  const note = (body.note ?? "").trim();
  if (!orderId || !note) return NextResponse.json({ error: "orderId and note are required" }, { status: 400 });

  const salespersonId = await getSalespersonId(db, sales.userId);
  if (!salespersonId) return NextResponse.json({ error: "Salesperson not linked" }, { status: 403 });

  const canAccess = await validateAssignment(db, orderId, salespersonId);
  if (!canAccess) return NextResponse.json({ error: "Not assigned to this order" }, { status: 403 });

  const { error } = await db.from("activity_logs").insert({
    user_id: sales.userId,
    activity_type: "NOTE_ADDED",
    entity_type: "order",
    entity_id: orderId,
    description: `Added note on urgent order${body.clientName ? ` (${body.clientName})` : ""}`,
    metadata: { note, order_id: orderId, scope: "urgent_order" },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  invalidateServerCache("urgent-my:");
  invalidateServerCache("urgent-admin:rows:");
  return NextResponse.json({ ok: true });
}
