import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type BranchManagerSeed = {
  full_name: string;
  full_name_ar: string;
  email: string;
  branch: string;
  title: "مدير فرع" | "نائب مدير فرع";
};

const DEFAULT_PASSWORD = "1234";

const BRANCH_MANAGERS: BranchManagerSeed[] = [
  { full_name: "Mohammed Samir Mohammed Ali", full_name_ar: "محمد سمير محمد على", email: "mohammed.samir@nstextile-eg.com", branch: "Azhar 2", title: "مدير فرع" },
  { full_name: "Eslam Yehia Abdelmoaty Abdelhamid", full_name_ar: "اسلام يحيى عبدالمعطى عبدالحميد", email: "eslam.yehia@nstextile-eg.com", branch: "Madinaty", title: "مدير فرع" },
  { full_name: "Samy Mahmoud Mohamed Ahmed", full_name_ar: "سامى محمود محمد احمد", email: "samy.mahmoud@nstextile-eg.com", branch: "Faisel", title: "مدير فرع" },
  { full_name: "Muhammad Nabil", full_name_ar: "محمد نبيل", email: "muhammad.nabil@nstextile-eg.com", branch: "Helwan", title: "مدير فرع" },
  { full_name: "Yassin Fathy Mohamed Ali Hamza", full_name_ar: "ياسين فتحي محمد علي حمزه", email: "yassin.fathy@nstextile-eg.com", branch: "Mall of egypt", title: "مدير فرع" },
  { full_name: "Anter Amr Ahmed Rashed", full_name_ar: "عنتر عمرو احمد راشد", email: "anter.amr@nstextile-eg.com", branch: "Moskey", title: "مدير فرع" },
  { full_name: "Tamer Abdelaleem Abdelaleem Elmasry", full_name_ar: "تامر عبدالعليم عبدالعليم المصرى", email: "tamer.elmasry@nstextile-eg.com", branch: "Hosery", title: "مدير فرع" },
  { full_name: "Ibrahim Kamel Mohamed Younes", full_name_ar: "ابراهيم كامل محمد يونس", email: "islam.ibrahim@nstextile-eg.com", branch: "Nozha", title: "مدير فرع" },
  { full_name: "Ahmed Magdy Bedir", full_name_ar: "احمد مجدى بدير", email: "ahmed.magdy.bedir@nstextile-eg.com", branch: "Mall of arabia", title: "مدير فرع" },
  { full_name: "Elshenawy Hassan Elshenawy Bayoumi", full_name_ar: "الشناوى حسن الشناوى بيومى", email: "amr.elshenawy@nstextile-eg.com", branch: "Alexandria", title: "مدير فرع" },
  { full_name: "Tamer Ali Abdelkhaleq Ali Ibrahim", full_name_ar: "تامر على عبدالخالق على ابراهيم", email: "tamerali@nstextile-eg.com", branch: "Moskey", title: "نائب مدير فرع" },
  { full_name: "Mohamed Roshdy Sayed Abouzeid", full_name_ar: "محمد رشدى سيد ابوزيد", email: "roshdy.mohamed@nstextile-eg.com", branch: "Trivium zayed", title: "مدير فرع" },
  { full_name: "Haitham Mohamed Elsayed Darwish", full_name_ar: "هيثم محمد السيد درويش", email: "haitham.mohammed@nstextile-eg.com", branch: "Tagamoa", title: "مدير فرع" },
  { full_name: "Abdelrahman Magdy Saber Abbas", full_name_ar: "عبدالرحمن مجدى صابر عباس", email: "abdelrahmanmagdy@nstextile-eg.com", branch: "Nasr city", title: "مدير فرع" },
  { full_name: "Moamen Ibrahim Ali Mohamed", full_name_ar: "مؤمن ابراهيم على محمد", email: "moamen.ibrahim@nstextile-eg.com", branch: "Tagamoa", title: "نائب مدير فرع" },
  { full_name: "Ahmed Saleh Helal Saleh", full_name_ar: "احمد صالح هلال صالح", email: "ahmed.saleh@nstextile-eg.com", branch: "Nozha", title: "نائب مدير فرع" },
  { full_name: "Ahmed Badawi Zaki Sayed", full_name_ar: "احمد بدوى زكى سيد", email: "ahmed.badawi@nstextile-eg.com", branch: "Hosery", title: "نائب مدير فرع" },
  { full_name: "Mohammed Hamouda Ibrahim Abdelrahim", full_name_ar: "محمد حموده ابراهيم عبدالرحيم", email: "mohammed.hamouda@nstextile-eg.com", branch: "Kal3a", title: "نائب مدير فرع" },
  { full_name: "Karim Mohamed Mohsen Abdelfattah", full_name_ar: "كريم محمد محسن عبدالفتاح", email: "karim.mohamed@nstextile-eg.com", branch: "Azhar 1", title: "مدير فرع" },
  { full_name: "Sherif Abdelmoneim Ali Ahmed Ali", full_name_ar: "شريف عبدالمنعم على احمد على", email: "sherif.abdelmoneim@nstextile-eg.com", branch: "Azhar 3", title: "نائب مدير فرع" },
  { full_name: "Mohamed Ahmed Fakhry Ismail Saber", full_name_ar: "محمد احمد فخري اسماعيل صابر", email: "mohamed.fakhry@nstextile-eg.com", branch: "Nasr city", title: "نائب مدير فرع" },
  { full_name: "Aya Hamed Rashed Elfayoumi", full_name_ar: "ايه حامد راشد الفيومي", email: "aya.hamed@nstextile-eg.com", branch: "Damietta retail", title: "نائب مدير فرع" },
  { full_name: "Moamen Adly Ali Ahmed", full_name_ar: "مؤمن عدلى على احمد", email: "momen.hamza@nstextile-eg.com", branch: "Faisel", title: "نائب مدير فرع" },
  { full_name: "Mahmoud Mohamed Abdelsamie Radwan", full_name_ar: "محمود محمد عبدالسميع رضوان", email: "mahmoued.mohamed@nstextile-eg.com", branch: "Tagamoa", title: "نائب مدير فرع" },
  { full_name: "Muhammad Farag Mahmoud Soliman Nawar", full_name_ar: "محمد فرج محمود سليمان نوار", email: "muhammad.farag@nstextile-eg.com", branch: "Alexandria", title: "نائب مدير فرع" },
  { full_name: "Sherif Youssef Mohamed Hassieb", full_name_ar: "شريف يوسف محمد حسيب", email: "sherif.hassieb@nstextile-eg.com", branch: "Damietta retail", title: "مدير فرع" },
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
    branch: string;
    title: string;
    user_id?: string;
    scoped_salespersons: number;
    status: "created" | "updated" | "error";
    message?: string;
  }> = [];

  for (const seed of BRANCH_MANAGERS) {
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
          user_metadata: {
            full_name: seed.full_name,
            full_name_ar: seed.full_name_ar,
            role: "admin",
            title: seed.title,
            branch: seed.branch,
          },
        });
      } else {
        const created = await (admin as any).auth.admin.createUser({
          email: seed.email,
          password: DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: {
            full_name: seed.full_name,
            full_name_ar: seed.full_name_ar,
            role: "admin",
            title: seed.title,
            branch: seed.branch,
          },
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
          full_name: seed.full_name_ar,
          role: "admin",
          is_active: true,
          is_super_admin: false,
        },
        { onConflict: "id" }
      );

      await (admin as any).from("admin_branch_scope").delete().eq("admin_user_id", userId);
      const branchIns = await (admin as any).from("admin_branch_scope").insert([
        { admin_user_id: userId, branch_name: seed.branch },
      ]);
      if (branchIns.error) throw new Error(branchIns.error.message);

      const salespersonIds = new Set<string>();
      const { data: rows, error } = await (admin as any)
        .from("orders")
        .select("salesperson_id")
        .ilike("branch", seed.branch)
        .not("salesperson_id", "is", null)
        .limit(5000);
      if (error) throw new Error(error.message);
      for (const row of rows ?? []) {
        const sid = String((row as { salesperson_id?: string | null }).salesperson_id ?? "").trim();
        if (sid) salespersonIds.add(sid);
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
        branch: seed.branch,
        title: seed.title,
        user_id: userId ?? undefined,
        scoped_salespersons: salespersonIds.size,
        status: existing ? "updated" : "created",
      });
    } catch (e: unknown) {
      results.push({
        email: seed.email,
        full_name: seed.full_name,
        branch: seed.branch,
        title: seed.title,
        scoped_salespersons: 0,
        status: "error",
        message: e instanceof Error ? e.message : "Failed",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    password: DEFAULT_PASSWORD,
    count: results.length,
    results,
  });
}
