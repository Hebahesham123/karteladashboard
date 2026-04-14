import { NextResponse } from "next/server";
import { createClient as createBrowserClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Called by a logged-in sales user whose salesperson record isn't linked yet.
 * Finds the salesperson row whose code matches the user's email prefix,
 * then sets user_id = current user's auth UID.
 */
export async function POST() {
  const supabase = createBrowserClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createAdminClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Extract the code prefix from the email (e.g. nsr1665@gmail.com → nsr1665)
  const emailPrefix = (user.email ?? "").split("@")[0].toLowerCase();

  // Find the salesperson whose code (lowercased, stripped) matches the email prefix
  const { data: allSps } = await (admin as any)
    .from("salespersons")
    .select("id, code, name, user_id");

  const match = (allSps ?? []).find((sp: any) => {
    const derived = sp.code.toLowerCase().replace(/[^a-z0-9]/g, "");
    return derived === emailPrefix;
  });

  if (!match) {
    return NextResponse.json({ error: "No matching salesperson found for this account" }, { status: 404 });
  }

  // If this salesperson is linked to another auth user, re-link it to current user.
  // This fixes cases where the salesperson was attached to a wrong/old account.
  if (match.user_id && match.user_id !== user.id) {
    await (admin as any)
      .from("salespersons")
      .update({ user_id: null })
      .eq("id", match.id);
  }

  // Update user row to ensure role = sales
  await (admin as any).from("users").upsert(
    { id: user.id, email: user.email, full_name: user.user_metadata?.full_name ?? match.name, role: "sales", is_active: true },
    { onConflict: "id" }
  );

  // Keep a single salesperson per auth user: unlink any other salesperson rows first.
  await (admin as any)
    .from("salespersons")
    .update({ user_id: null })
    .eq("user_id", user.id)
    .neq("id", match.id);

  // Link
  const { error } = await (admin as any)
    .from("salespersons")
    .update({ user_id: user.id })
    .eq("id", match.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, salesperson_id: match.id });
}
