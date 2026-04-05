import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function toEmail(code: string): string {
  // e.g. "NSR1596" → "nsr1596@gmail.com"
  return `${code.toLowerCase().replace(/[^a-z0-9]/g, "")}@gmail.com`;
}

export async function POST(_req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch all salespersons (including those already linked, so we can return their emails)
  const { data: salespersons, error: spErr } = await (admin as any)
    .from("salespersons")
    .select("id, code, name, user_id");

  if (spErr) {
    return NextResponse.json({ error: spErr.message }, { status: 500 });
  }

  const results: { code: string; email: string; status: string }[] = [];

  for (const sp of (salespersons || []) as any[]) {
    const email    = toEmail(sp.code);
    const password = "sales123";

    // Already has an account — skip creation, just report
    if (sp.user_id) {
      results.push({ code: sp.code, email, status: "already_exists" });
      continue;
    }

    // 1. Create Supabase auth user
    const { data: authData, error: authErr } = await (admin as any).auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: sp.name, role: "sales" },
    });

    if (authErr || !authData?.user) {
      results.push({ code: sp.code, email, status: `error: ${authErr?.message}` });
      continue;
    }

    const uid = authData.user.id;

    // 2. Create public.users row
    await (admin as any).from("users").upsert(
      { id: uid, email, full_name: sp.name, role: "sales", is_active: true },
      { onConflict: "id" }
    );

    // 3. Link salesperson → user
    await (admin as any).from("salespersons").update({ user_id: uid }).eq("id", sp.id);

    results.push({ code: sp.code, email, status: "created" });
  }

  const created = results.filter((r) => r.status === "created").length;
  const skipped = results.filter((r) => r.status === "already_exists").length;
  const failed  = results.filter((r) => r.status.startsWith("error")).length;

  return NextResponse.json({ created, skipped, failed, accounts: results });
}
