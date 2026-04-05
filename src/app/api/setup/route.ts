import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TEST_USERS = [
  { email: "admin@cartela.com", password: "Admin@123456", full_name: "Admin User", role: "admin" },
  { email: "sales1@cartela.com", password: "Sales@123456", full_name: "أمير مصطفى", role: "sales" },
  { email: "sales2@cartela.com", password: "Sales@123456", full_name: "محمد عبدالمعطي", role: "sales" },
];

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not set in .env.local" },
      { status: 500 }
    );
  }

  // Admin client with service role — bypasses email confirmation
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const results = [];

  for (const user of TEST_USERS) {
    try {
      // Create user with email_confirm: true (no confirmation email needed)
      const { data, error } = await adminClient.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { full_name: user.full_name, role: user.role },
      });

      if (error && !error.message.includes("already been registered")) {
        results.push({ email: user.email, status: "error", message: error.message });
        continue;
      }

      const userId = data?.user?.id;

      if (userId) {
        // Upsert into public.users table
        await (adminClient as any).from("users").upsert({
          id: userId,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          is_active: true,
        });
      } else {
        // User already existed — find their ID and update role
        const { data: existing } = await (adminClient as any)
          .from("users")
          .select("id")
          .eq("email", user.email)
          .single();

        if (existing?.id) {
          await (adminClient as any)
            .from("users")
            .update({ role: user.role, full_name: user.full_name })
            .eq("id", existing.id);
        }
      }

      results.push({ email: user.email, status: "success" });
    } catch (err: any) {
      results.push({ email: user.email, status: "error", message: err?.message });
    }
  }

  return NextResponse.json({ results });
}
