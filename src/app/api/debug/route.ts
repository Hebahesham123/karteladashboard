import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const info: Record<string, any> = {
    supabaseUrl: supabaseUrl || "MISSING",
    hasServiceRoleKey: !!serviceRoleKey,
    hasAnonKey: !!anonKey,
  };

  if (!serviceRoleKey) {
    return NextResponse.json({ error: "No service role key", info });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Check auth users
  try {
    const { data: authUsers, error } = await admin.auth.admin.listUsers();
    info.authUsers = authUsers?.users?.map((u) => ({
      id: u.id,
      email: u.email,
      confirmed: u.email_confirmed_at ? true : false,
      created: u.created_at,
    })) ?? [];
    info.authError = error?.message;
  } catch (e: any) {
    info.authError = e.message;
  }

  // Check public.users table
  try {
    const { data: publicUsers, error } = await (admin as any)
      .from("users")
      .select("id, email, role, is_active");
    info.publicUsers = publicUsers;
    info.publicUsersError = error?.message;
  } catch (e: any) {
    info.publicUsersError = e.message;
  }

  // Check if schema tables exist
  try {
    const { data: tables, error } = await (admin as any).rpc("pg_tables_list").select("*");
    info.tablesError = error?.message;
  } catch (e: any) {
    info.tablesCheckError = e.message;
  }

  return NextResponse.json(info, { status: 200 });
}
