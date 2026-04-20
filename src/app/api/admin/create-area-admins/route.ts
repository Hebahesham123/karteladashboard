import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type AreaAdminSeed = {
  full_name: string;
  email: string;
  branches: string[];
};

const DEFAULT_PASSWORD = "1234";

const AREA_ADMINS: AreaAdminSeed[] = [
  {
    full_name: "Youssef Ramzy",
    email: "youssef.ramzy@nstextile-eg.com",
    branches: ["Southgate", "Mivida", "Trivium zayed", "Mall of arabia", "Mall of egypt"],
  },
  {
    full_name: "Ahmed Magdy Bedir",
    email: "ahmed.magdy.bedir@nstextile-eg.com",
    branches: ["Mall of Arabia", "Mall of egypt", "Trivium zayed"],
  },
  {
    full_name: "Ahmed Essam",
    email: "ahmed.essam@nstextile-eg.com",
    branches: ["Azhar 2", "Azhar 3", "Kal3a", "Moskey"],
  },
  {
    full_name: "Shenouda Samir",
    email: "shenouda.samir@nstextile-eg.com",
    branches: ["Faisel", "Helwan", "Hosery"],
  },
  {
    full_name: "Abdelrahman Magdy",
    email: "abdelrahmanmagdy@nstextile-eg.com",
    branches: ["Nasr city", "Nozha", "Maadi"],
  },
  {
    full_name: "Amr Elshenawy",
    email: "amr.elshenawy@nstextile-eg.com",
    branches: ["Tanta", "Alexandria"],
  },
];

async function requireAdmin() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await supabase
    .from("users")
    .select("id, role, is_super_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (!Boolean((profile as any)?.is_super_admin ?? false)) {
    return { error: NextResponse.json({ error: "Forbidden: super admin only" }, { status: 403 }) };
  }
  return { userId: user.id };
}

export async function POST() {
  const authz = await requireAdmin();
  if ("error" in authz) return authz.error;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase env variables" }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const results: Array<{
    email: string;
    full_name: string;
    user_id?: string;
    scoped_salespersons: number;
    status: "created" | "updated" | "error";
    message?: string;
  }> = [];

  for (const seed of AREA_ADMINS) {
    try {
      let userId: string | null = null;

      const listed = await (admin as any).auth.admin.listUsers({
        filter: `email.eq.${seed.email}`,
      });
      const existing = listed.data?.users?.[0] ?? null;

      if (existing?.id) {
        userId = existing.id;
        await (admin as any).auth.admin.updateUserById(existing.id, {
          password: DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: { full_name: seed.full_name, role: "admin" },
        });
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

      await (admin as any).from("users").upsert(
        {
          id: userId,
          email: seed.email,
          full_name: seed.full_name,
          role: "admin",
          is_active: true,
          is_super_admin: false,
        },
        { onConflict: "id" }
      );

      // Persist explicit branch scope as source-of-truth.
      await (admin as any).from("admin_branch_scope").delete().eq("admin_user_id", userId);
      if (seed.branches.length > 0) {
        const branchRows = seed.branches.map((b) => ({
          admin_user_id: userId,
          branch_name: b,
        }));
        const branchIns = await (admin as any).from("admin_branch_scope").insert(branchRows);
        if (branchIns.error) throw new Error(branchIns.error.message);
      }

      const salespersonIds = new Set<string>();
      for (const branch of seed.branches) {
        const { data: rows, error } = await (admin as any)
          .from("orders")
          .select("salesperson_id")
          .ilike("branch", branch)
          .not("salesperson_id", "is", null)
          .limit(5000);
        if (error) throw new Error(error.message);
        for (const row of rows ?? []) {
          const sid = String((row as { salesperson_id?: string | null }).salesperson_id ?? "").trim();
          if (sid) salespersonIds.add(sid);
        }
      }

      await (admin as any).from("admin_salesperson_scope").delete().eq("admin_user_id", userId);
      if (salespersonIds.size > 0) {
        const payload = Array.from(salespersonIds).map((sid) => ({
          admin_user_id: userId,
          salesperson_id: sid,
        }));
        const ins = await (admin as any).from("admin_salesperson_scope").insert(payload);
        if (ins.error) throw new Error(ins.error.message);
      }

      results.push({
        email: seed.email,
        full_name: seed.full_name,
        user_id: userId ?? undefined,
        scoped_salespersons: salespersonIds.size,
        status: existing ? "updated" : "created",
      });
    } catch (e: unknown) {
      results.push({
        email: seed.email,
        full_name: seed.full_name,
        scoped_salespersons: 0,
        status: "error",
        message: e instanceof Error ? e.message : "Failed",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    password: DEFAULT_PASSWORD,
    results,
  });
}
