import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function toEmail(code: string): string {
  return `${code.toLowerCase().replace(/[^a-z0-9]/g, "")}@gmail.com`;
}

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Get ALL unlinked salespersons
  const { data: salespersons, error: spErr } = await (admin as any)
    .from("salespersons")
    .select("id, code, name, user_id")
    .is("user_id", null);

  if (spErr) {
    return NextResponse.json({ error: spErr.message }, { status: 500 });
  }

  const results: { code: string; email: string; name: string; status: string }[] = [];
  const PASSWORD = "sales123";

  for (const sp of (salespersons ?? []) as any[]) {
    const email = toEmail(sp.code);

    // ── Try to find existing auth user by email (reliable, no pagination limit) ──
    const { data: found } = await (admin as any).auth.admin.listUsers({
      filter: `email.eq.${email}`,
    });
    const existingUser = found?.users?.[0] ?? null;

    if (existingUser) {
      // Account exists → ensure public.users row is correct, then link
      await (admin as any).from("users").upsert(
        { id: existingUser.id, email, full_name: sp.name, role: "sales", is_active: true },
        { onConflict: "id" }
      );
      const { error: linkErr } = await (admin as any)
        .from("salespersons")
        .update({ user_id: existingUser.id })
        .eq("id", sp.id);

      results.push({
        code: sp.code, email, name: sp.name,
        status: linkErr ? `error: ${linkErr.message}` : "linked",
      });
      continue;
    }

    // ── No account found → create one then link ──
    const { data: authData, error: authErr } = await (admin as any).auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: sp.name, role: "sales" },
    });

    if (authErr || !authData?.user) {
      results.push({ code: sp.code, email, name: sp.name, status: `error: ${authErr?.message}` });
      continue;
    }

    const uid = authData.user.id;

    await (admin as any).from("users").upsert(
      { id: uid, email, full_name: sp.name, role: "sales", is_active: true },
      { onConflict: "id" }
    );
    await (admin as any).from("salespersons").update({ user_id: uid }).eq("id", sp.id);

    results.push({ code: sp.code, email, name: sp.name, status: "created" });
  }

  return NextResponse.json({
    created: results.filter((r) => r.status === "created").length,
    linked:  results.filter((r) => r.status === "linked").length,
    failed:  results.filter((r) => r.status.startsWith("error")).length,
    accounts: results,
  });
}
