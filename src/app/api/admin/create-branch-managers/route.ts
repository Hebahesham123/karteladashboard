import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { expandBranchAliases } from "@/lib/branchAliases";

export const dynamic = "force-dynamic";

type BranchManagerSeed = {
  full_name: string;
  full_name_ar: string;
  email: string;
  branch: string;
  title: "مدير فرع" | "نائب مدير فرع";
};

const DEFAULT_PASSWORD = "123456";

const BRANCH_MANAGERS: BranchManagerSeed[] = [
  { full_name: "Mohammed Samir Mohammed Ali", full_name_ar: "محمد سمير محمد على", email: "mohammed.samir@nstextile-eg.com", branch: "Azhar 2", title: "مدير فرع" },
  { full_name: "Eslam Yehia Abdelmoaty Abdelhamid", full_name_ar: "اسلام يحيى عبدالمعطى عبدالحميد", email: "eslam.yehia@nstextile-eg.com", branch: "Madinaty", title: "مدير فرع" },
  { full_name: "Samy Mahmoud Mohamed Ahmed", full_name_ar: "سامى محمود محمد احمد", email: "samy.mahmoud@nstextile-eg.com", branch: "Azhar 3", title: "مدير فرع" },
  { full_name: "Muhammad Nabil", full_name_ar: "محمد نبيل", email: "muhammad.nabil@nstextile-eg.com", branch: "Helwan", title: "نائب مدير فرع" },
  { full_name: "Yassin Fathy Mohamed Ali Hamza", full_name_ar: "ياسين فتحي محمد علي حمزه", email: "yassin.fathy@nstextile-eg.com", branch: "Mall of egypt", title: "مدير فرع" },
  { full_name: "Anter Amr Ahmed Rashed", full_name_ar: "عنتر عمرو احمد راشد", email: "anter.amr@nstextile-eg.com", branch: "Moskey", title: "مدير فرع" },
  { full_name: "Tamer Abdelaleem Abdelaleem Elmasry", full_name_ar: "تامر عبدالعليم عبدالعليم المصرى", email: "tamer.elmasry@nstextile-eg.com", branch: "Hosery", title: "مدير فرع" },
  { full_name: "Ibrahim Kamel Mohamed Younes", full_name_ar: "ابراهيم كامل محمد يونس", email: "islam.ibrahim@nstextile-eg.com", branch: "Nasr city", title: "مدير فرع" },
  { full_name: "Tamer Ali Abdelkhaleq Ali Ibrahim", full_name_ar: "تامر على عبدالخالق على ابراهيم", email: "tamerali@nstextile-eg.com", branch: "Azhar 2", title: "مدير فرع" },
  { full_name: "Mohamed Roshdy Sayed Abouzeid", full_name_ar: "محمد رشدى سيد ابوزيد", email: "roshdy.mohamed@nstextile-eg.com", branch: "Trivium zayed", title: "مدير فرع" },
  { full_name: "Haitham Mohamed Elsayed Darwish", full_name_ar: "هيثم محمد السيد درويش", email: "haitham.mohammed@nstextile-eg.com", branch: "Tagamoa", title: "مدير فرع" },
  { full_name: "Moamen Ibrahim Ali Mohamed", full_name_ar: "مؤمن ابراهيم على محمد", email: "moamen.ibrahim@nstextile-eg.com", branch: "Tagamoa", title: "نائب مدير فرع" },
  { full_name: "Ahmed Saleh Helal Saleh", full_name_ar: "احمد صالح هلال صالح", email: "ahmed.saleh@nstextile-eg.com", branch: "Nozha", title: "نائب مدير فرع" },
  { full_name: "Ahmed Badawi Zaki Sayed", full_name_ar: "احمد بدوى زكى سيد", email: "ahmed.badawi@nstextile-eg.com", branch: "Hosery", title: "نائب مدير فرع" },
  { full_name: "Mohammed Hamouda Ibrahim Abdelrahim", full_name_ar: "محمد حموده ابراهيم عبدالرحيم", email: "mohammed.hamouda@nstextile-eg.com", branch: "Kal3a", title: "نائب مدير فرع" },
  { full_name: "Karim Mohamed Mohsen Abdelfattah", full_name_ar: "كريم محمد محسن عبدالفتاح", email: "karim.mohamed@nstextile-eg.com", branch: "Azhar 1", title: "مدير فرع" },
  { full_name: "Sherif Abdelmoneim Ali Ahmed Ali", full_name_ar: "شريف عبدالمنعم على احمد على", email: "sherif.abdelmoneim@nstextile-eg.com", branch: "Azhar 3", title: "نائب مدير فرع" },
  { full_name: "Mohamed Ahmed Fakhry Ismail Saber", full_name_ar: "محمد احمد فخري اسماعيل صابر", email: "mohamed.fakhry@nstextile-eg.com", branch: "Nasr city", title: "نائب مدير فرع" },
  { full_name: "Aya Hamed Rashed Elfayoumi", full_name_ar: "ايه حامد راشد الفيومي", email: "aya.hamed@nstextile-eg.com", branch: "Damietta retail", title: "نائب مدير فرع" },
  { full_name: "Moamen Adly Ali Ahmed", full_name_ar: "مؤمن عدلى على احمد", email: "momen.hamza@nstextile-eg.com", branch: "Faisel", title: "مدير فرع" },
  { full_name: "Mahmoud Mohamed Abdelsamie Radwan", full_name_ar: "محمود محمد عبدالسميع رضوان", email: "mahmoued.mohamed@nstextile-eg.com", branch: "Tagamoa", title: "نائب مدير فرع" },
  { full_name: "Muhammad Farag Mahmoud Soliman Nawar", full_name_ar: "محمد فرج محمود سليمان نوار", email: "muhammad.farag@nstextile-eg.com", branch: "Alexandria", title: "نائب مدير فرع" },
  { full_name: "Sherif Youssef Mohamed Hassieb", full_name_ar: "شريف يوسف محمد حسيب", email: "sherif.hassieb@nstextile-eg.com", branch: "Damietta retail", title: "مدير فرع" },
  { full_name: "Eslam Ibrahim Ali Mohamed", full_name_ar: "اسلام ابراهيم علي محمد", email: "eslam.ali@nstextile-eg.com", branch: "Maadi", title: "نائب مدير فرع" },
  { full_name: "Hossam Hassan Atia Elleithy", full_name_ar: "حسام حسن عطيه الليثي", email: "hossam.hassan@nstextile-eg.com", branch: "Moskey", title: "نائب مدير فرع" },
  // Rows from Excel without a company email — synthesized @gmail.com handles.
  { full_name: "Simon Khair Israel", full_name_ar: "سيمون خير اسرائيل", email: "simon.israel@gmail.com", branch: "Maadi", title: "مدير فرع" },
  { full_name: "Mohamed Ahmed Salim Afifi", full_name_ar: "محمد احمد سليم عفيفي", email: "mohamed.afifi@gmail.com", branch: "Madinaty", title: "مدير فرع" },
  { full_name: "Mohamed Tarek Mostafa Abdelghaffar", full_name_ar: "محمد طارق مصطفى عبد الغفار", email: "mohamed.tarek@gmail.com", branch: "Kal3a", title: "مدير فرع" },
  { full_name: "Amr Abdelati Ahmed Abdelati", full_name_ar: "عمرو عبدالعاطي احمد عبدالعاطي", email: "amr.abdelati@gmail.com", branch: "Nozha", title: "مدير فرع" },
  { full_name: "Ihab Mohamed Elarabi Abdelaal Elsayed", full_name_ar: "ايهاب محمد العربي عبدالعال السيد", email: "ihab.elarabi@gmail.com", branch: "Helwan", title: "مدير فرع" },
  { full_name: "Mohamed Saad Mahmoud Awad Eldaqaq", full_name_ar: "محمد سعد محمود عوض الدقاق", email: "mohamed.eldaqaq@gmail.com", branch: "Mansoura", title: "مدير فرع" },
  { full_name: "Amr Ayman Ali Anani Ahmed", full_name_ar: "عمرو ايمن علي عناني احمد", email: "amr.ayman@gmail.com", branch: "Alexandria", title: "مدير فرع" },
  { full_name: "Mohammed Samir Mohamed Ali (Tanta)", full_name_ar: "محمد سمير محمد علي", email: "mohamed.samir.tanta@gmail.com", branch: "Tanta", title: "مدير فرع" },
  { full_name: "Osama Mohamed Ibrahim AbouTaleb", full_name_ar: "اسامه محمد ابراهيم ابوطالب", email: "osama.aboutaleb@gmail.com", branch: "Zagazig", title: "مدير فرع" },
  { full_name: "Khaled Mohamed Elsayed Abdelmoneim", full_name_ar: "خالد محمد السيد عبدالمنعم", email: "khaled.abdelmoneim@gmail.com", branch: "Hosery", title: "مدير فرع" },
  { full_name: "Hassan Abdelaziz Hassan Ali", full_name_ar: "حسن عبدالعزيز حسن علي", email: "hassan.abdelaziz@gmail.com", branch: "Mall of egypt", title: "مدير فرع" },
  { full_name: "Sameh Saeed Othman Othman", full_name_ar: "سامح سعيد عثمان عثمان", email: "sameh.othman@gmail.com", branch: "Trivium zayed", title: "مدير فرع" },
  { full_name: "Eslam Mohamed Gamal Abdelfattah Sherif", full_name_ar: "اسلام محمد جمال عبدالفتاح شريف", email: "eslam.gamal@gmail.com", branch: "Azhar 2", title: "مدير فرع" },
  { full_name: "Samir Mohamed Abdelmoneim Mahmoud Klib", full_name_ar: "سمير محمد عبدالمنعم محمود كليب", email: "samir.klib@gmail.com", branch: "Tanta", title: "مدير فرع" },
  { full_name: "Hany Khalil Yacoub Khalil", full_name_ar: "هاني خليل يعقوب خليل", email: "hany.khalil@gmail.com", branch: "Azhar 2", title: "نائب مدير فرع" },
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

  // listUsers({ filter }) is unreliable in some Supabase versions — verify the
  // email match exactly so we never accept the first row as a false positive.
  const lookupByEmail = async (email: string) => {
    const target = email.trim().toLowerCase();
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

  for (const seed of BRANCH_MANAGERS) {
    try {
      let userId: string | null = null;

      const existing = await lookupByEmail(seed.email);

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
      // Expand the branch name to every known DB variant so Arabic/English/spelling
      // differences don't leave the salesperson scope empty.
      const branchVariants = expandBranchAliases(seed.branch);
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: rows, error } = await (admin as any)
          .from("orders")
          .select("salesperson_id")
          .in("branch", branchVariants)
          .not("salesperson_id", "is", null)
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        if (!rows?.length) break;
        for (const row of rows) {
          const sid = String((row as { salesperson_id?: string | null }).salesperson_id ?? "").trim();
          if (sid) salespersonIds.add(sid);
        }
        if (rows.length < PAGE) break;
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
