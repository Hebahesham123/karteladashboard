import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { invalidateServerCache } from "@/lib/serverResponseCache";

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

/** Delete order-linked activity logs (notes), then all orders (cascades urgent_order_assignments), then upload batch rows. */
export async function POST() {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });

  try {
    const { error: logDelErr } = await db.from("activity_logs").delete().eq("entity_type", "order");
    if (logDelErr) throw new Error(logDelErr.message);

    let deletedOrders = 0;
    for (;;) {
      const { data: batch, error: selErr } = await db.from("orders").select("id").limit(800);
      if (selErr) throw new Error(selErr.message);
      if (!batch?.length) break;
      const ids = batch.map((r) => r.id as string);
      const { error: delErr } = await db.from("orders").delete().in("id", ids);
      if (delErr) throw new Error(delErr.message);
      deletedOrders += ids.length;
      if (ids.length < 800) break;
    }

    for (;;) {
      const { data: batch, error: selErr } = await db.from("upload_batches").select("id").limit(800);
      if (selErr) throw new Error(selErr.message);
      if (!batch?.length) break;
      const ids = batch.map((r) => r.id as string);
      const { error: delErr } = await db.from("upload_batches").delete().in("id", ids);
      if (delErr) throw new Error(delErr.message);
      if (ids.length < 800) break;
    }

    invalidateServerCache("urgent-");
    invalidateServerCache("order-distinct");

    return NextResponse.json({
      success: true,
      deletedOrders,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Clear failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
