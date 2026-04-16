import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { invalidateServerCache } from "@/lib/serverResponseCache";
import type { ClientStatus } from "@/types/database";

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

  const { data: profile } = await supabase.from("users").select("id, role").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== "sales") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { userId: user.id };
}

async function getSalespersonId(db: ReturnType<typeof createClient>, userId: string) {
  const { data: sp } = await db.from("salespersons").select("id").eq("user_id", userId).maybeSingle();
  return sp?.id ?? null;
}

const REASON_REQUIRED: ClientStatus[] = ["LOST", "CANCELLED"];

export async function PATCH(req: NextRequest) {
  const sales = await requireSalesUser();
  if ("error" in sales) return sales.error;
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });

  const body = (await req.json()) as {
    orderId?: string;
    newStatus?: ClientStatus;
    reason?: string;
    clientName?: string;
  };
  const orderId = (body.orderId ?? "").trim();
  const newStatus = body.newStatus;
  if (!orderId || !newStatus) {
    return NextResponse.json({ error: "orderId and newStatus are required" }, { status: 400 });
  }

  const reason = (body.reason ?? "").trim();
  if (REASON_REQUIRED.includes(newStatus) && !reason) {
    return NextResponse.json({ error: "Reason is required for this status" }, { status: 400 });
  }

  const salespersonId = await getSalespersonId(db, sales.userId);
  if (!salespersonId) return NextResponse.json({ error: "Salesperson not linked" }, { status: 403 });

  const { data: assignment, error: aErr } = await db
    .from("urgent_order_assignments")
    .select("id, client_status")
    .eq("order_id", orderId)
    .eq("salesperson_id", salespersonId)
    .eq("is_active", true)
    .maybeSingle();
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (!assignment?.id) return NextResponse.json({ error: "Not assigned to this order" }, { status: 403 });

  const old = (assignment.client_status as ClientStatus | null) ?? null;

  const { error: uErr } = await db
    .from("urgent_order_assignments")
    .update({ client_status: newStatus })
    .eq("id", assignment.id);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  await db.from("activity_logs").insert({
    user_id: sales.userId,
    activity_type: "STATUS_CHANGE",
    entity_type: "order",
    entity_id: orderId,
    description: `Urgent order status${body.clientName ? ` (${body.clientName})` : ""}: ${old ?? "—"} → ${newStatus}`,
    metadata: { order_id: orderId, old_status: old, new_status: newStatus, reason: reason || null, scope: "urgent_order" },
  });

  invalidateServerCache("urgent-my:");
  invalidateServerCache("urgent-admin:rows:");
  return NextResponse.json({ ok: true, newStatus });
}
