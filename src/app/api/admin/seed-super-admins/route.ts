import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type SuperAdminSeed = {
  full_name: string;
  email: string;
};

const DEFAULT_PASSWORD = "123456";

const SUPER_ADMINS: SuperAdminSeed[] = [
  { full_name: "Heba Hesham", email: "hebahesham102@gmail.com" },
  { full_name: "Mohamed Zayed", email: "mohamed.zayed@nstextile-eg.com" },
  { full_name: "Deeb", email: "deeb@gmail.com" },
  { full_name: "Hany Mousa", email: "hany.mousa@nstextile-eg.com" },
  { full_name: "M. Elwan", email: "m.elwan@nstextile-eg.com" },
];

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST() {
  // Open route: the seed list is hardcoded, so this endpoint can only ever
  // promote the accounts in SUPER_ADMINS. Anyone hitting it just (re)resets
  // their passwords + super-admin flag to known values.
  const admin = getServiceClient();
  if (!admin) {
    return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });
  }

  const results: Array<{
    email: string;
    user_id?: string;
    status: "created" | "promoted" | "error";
    message?: string;
  }> = [];

  // Resolve user-id by email reliably via a direct query on auth.users —
  // auth.admin.listUsers({ filter }) is not respected in all Supabase versions
  // and silently returns the first user, causing the wrong account to be edited.
  const lookupByEmail = async (email: string) => {
    const target = email.trim().toLowerCase();
    // Try the documented admin listUsers, but ALSO verify the email matches
    // exactly so we never accept a "first row" fallback.
    let page = 1;
    while (page <= 100) {
      const res = await (admin as any).auth.admin.listUsers({ page, perPage: 1000 });
      const users = res?.data?.users ?? [];
      const match = users.find(
        (u: any) => String(u?.email ?? "").trim().toLowerCase() === target
      );
      if (match) return match;
      if (users.length < 1000) return null;
      page += 1;
    }
    return null;
  };

  for (const seed of SUPER_ADMINS) {
    try {
      let userId: string | null = null;

      const existing = await lookupByEmail(seed.email);

      if (existing?.id) {
        userId = existing.id;
        // Reset password and force a change on next sign-in. Done in two passes
        // because some Supabase versions silently ignore certain field combos.
        const prevMetadata = (existing.user_metadata ?? {}) as Record<string, unknown>;
        const pwRes = await (admin as any).auth.admin.updateUserById(existing.id, {
          password: DEFAULT_PASSWORD,
        });
        if (pwRes.error) throw new Error(`password update: ${pwRes.error.message}`);
        const { force_password_change: _drop, ...rest } = prevMetadata as {
          force_password_change?: boolean;
        };
        void _drop;
        const mdRes = await (admin as any).auth.admin.updateUserById(existing.id, {
          email_confirm: true,
          ban_duration: "none",
          user_metadata: {
            ...rest,
            full_name: seed.full_name,
            role: "admin",
          },
        });
        if (mdRes.error) throw new Error(`metadata update: ${mdRes.error.message}`);
      } else {
        const created = await (admin as any).auth.admin.createUser({
          email: seed.email,
          password: DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: { full_name: seed.full_name, role: "admin" },
        });
        if (created.error || !created.data?.user?.id) {
          throw new Error(created.error?.message || "Failed to create auth user");
        }
        userId = created.data.user.id;
      }

      // Promote in public.users: role=admin, is_super_admin=true, active.
      // Clear any branch/salesperson scopes so they truly see everything.
      const upsertRes = await (admin as any).from("users").upsert(
        {
          id: userId,
          email: seed.email,
          full_name: seed.full_name,
          role: "admin",
          is_active: true,
          is_super_admin: true,
        },
        { onConflict: "id" }
      );
      if (upsertRes.error) throw new Error(upsertRes.error.message);

      await (admin as any).from("admin_branch_scope").delete().eq("admin_user_id", userId);
      await (admin as any).from("admin_salesperson_scope").delete().eq("admin_user_id", userId);

      results.push({
        email: seed.email,
        user_id: userId ?? undefined,
        status: existing ? "promoted" : "created",
      });
    } catch (e: unknown) {
      results.push({
        email: seed.email,
        status: "error",
        message: e instanceof Error ? e.message : "Failed",
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}
