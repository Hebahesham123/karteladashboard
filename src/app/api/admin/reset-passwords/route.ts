import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch all linked salespersons (those with a user_id)
  const { data: salespersons, error: spErr } = await (admin as any)
    .from("salespersons")
    .select("id, code, name, user_id")
    .not("user_id", "is", null);

  if (spErr) {
    return NextResponse.json({ error: spErr.message }, { status: 500 });
  }

  let reset = 0;
  let failed = 0;

  for (const sp of (salespersons ?? []) as any[]) {
    const { error } = await (admin as any).auth.admin.updateUserById(sp.user_id, {
      password: "sales123",
    });
    if (error) { failed++; } else { reset++; }
  }

  return NextResponse.json({ reset, failed });
}
