-- ============================================================
-- FIX: branch-scoped admins see an empty dashboard
-- ============================================================
-- Reported for the Faisel branch manager: every KPI reads 0, no data anywhere.
--
-- Cause: `admin_branch_scope.branch_name` stores the canonical English name
-- ("Faisel"), but `orders.branch` stores the raw value from the uploaded Excel
-- (the Arabic branch name). `admin_has_branch()` compared the two literally, so
-- the RLS policies on orders / clients / salespersons denied every row and the
-- whole dashboard collapsed to zeros. `branch_aliases` — the table the app
-- queries to bridge the two — was never created by any migration, so the
-- app-side fallback ("assume the scope value is already a real branch") matched
-- nothing either.
--
-- Fix:
--   1. public.normalize_branch()  — Arabic-aware comparison key, mirroring
--      normalizeBranch() in src/lib/branchAliases.ts.
--   2. public.branch_aliases      — canonical name -> every known spelling,
--      seeded from BRANCH_CANONICALS in src/lib/branchAliases.ts.
--   3. admin_has_branch()         — matches on normalized keys through the
--      alias expansion instead of comparing raw strings.
--
-- Safe to re-run.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Normalization: mirror of normalizeBranch() in the TS layer.
--    Strip a leading "branch [the]" prefix -> cut at the first dash ->
--    drop diacritics -> fold alef/yeh/teh-marbuta variants -> lowercase.
--
--    Written with \uXXXX escapes rather than literal Arabic so the logic stays
--    readable in a left-to-right editor and survives encoding round-trips.
--      فرع = "branch"      ال = "the"
--      ً-ٰ      = diacritics
--      أإآٱ -> ا (alef variants)
--      ى -> ي (alef maqsura -> yeh)
--      ة -> ه (teh marbuta -> heh)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_branch(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH t0 AS (SELECT btrim(coalesce(p_name, '')) AS v),
  t1 AS (SELECT regexp_replace(v, E'^\\s*فرع\\s+(ال)?', '') AS v FROM t0),
  t2 AS (SELECT split_part(regexp_replace(v, E'[–—]', '-', 'g'), '-', 1) AS v FROM t1),
  t3 AS (SELECT regexp_replace(v, E'[ً-ٰ]', '', 'g') AS v FROM t2),
  t4 AS (SELECT translate(v, E'أإآٱىة',
                             E'اااايه') AS v FROM t3)
  SELECT lower(btrim(regexp_replace(v, E'\\s+', ' ', 'g'))) FROM t4;
$$;

COMMENT ON FUNCTION public.normalize_branch(text) IS
  'Comparison key for branch names. Must stay in sync with normalizeBranch() in src/lib/branchAliases.ts.';

-- ------------------------------------------------------------
-- 2) Alias table: canonical name -> every spelling seen in orders.branch
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.branch_aliases (
  alias_name      text PRIMARY KEY,
  actual_branches text[] NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.branch_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "branch_aliases readable" ON public.branch_aliases;
CREATE POLICY "branch_aliases readable" ON public.branch_aliases
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "branch_aliases super admin writable" ON public.branch_aliases;
CREATE POLICY "branch_aliases super admin writable" ON public.branch_aliases
  FOR ALL USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

GRANT SELECT ON public.branch_aliases TO authenticated, anon, service_role;

-- Generated from BRANCH_CANONICALS in src/lib/branchAliases.ts.
-- Each array includes the canonical name itself plus every known variant.
INSERT INTO public.branch_aliases (alias_name, actual_branches) VALUES
  ('Damietta retail', ARRAY['Damietta retail', 'Damietta', 'فرع دمياط - تجزئة', 'فرع دمياط']),
  ('Nasr city', ARRAY['Nasr city', 'Nasr City', 'فرع مدينة نصر']),
  ('Moskey', ARRAY['Moskey', 'Mosky', 'فرع الموسكى', 'فرع الموسكي']),
  ('Amal', ARRAY['Amal', 'El Amal', 'فرع الامل', 'فرع الأمل']),
  ('Faisel', ARRAY['Faisel', 'Faisal', 'فرع فيصل']),
  ('Alexandria', ARRAY['Alexandria', 'فرع الاسكندرية']),
  ('Kal3a', ARRAY['Kal3a', 'Qalaa', 'Kalaa', 'فرع القلعة']),
  ('Helwan', ARRAY['Helwan', 'فرع حلوان']),
  ('Azhar 1', ARRAY['Azhar 1', 'فرع الازهر 1', 'فرع الأزهر 1']),
  ('OnLine Branch', ARRAY['OnLine Branch', 'Online Branch', 'اونلاين']),
  ('Azhar 2', ARRAY['Azhar 2', 'فرع الازهر2', 'فرع الأزهر2', 'فرع الازهر 2']),
  ('Hosery', ARRAY['Hosery', 'فرع الحصرى - اكتوبر', 'فرع الحصري - اكتوبر', 'فرع الحصرى', 'فرع الحصري']),
  ('Azhar 3', ARRAY['Azhar 3', 'فرع الازهر3', 'فرع الأزهر3', 'فرع الازهر 3']),
  ('Southgate', ARRAY['Southgate', 'South Gate', 'فرع ثاوث جيت - التجمع', 'فرع ساوث جيت', 'ثاوث جيت']),
  ('Maadi', ARRAY['Maadi', 'فرع زهراء المعادي', 'فرع زهراء المعادى', 'فرع المعادي', 'فرع المعادى']),
  ('Nozha', ARRAY['Nozha', 'فرع النزهة']),
  ('Tanta', ARRAY['Tanta', 'فرع طنطا']),
  ('Bostan', ARRAY['Bostan', 'Basateen', 'فرع البساتين']),
  ('Mini Franchise', ARRAY['Mini Franchise', 'Mini Franchise Branch']),
  ('Mall of arabia', ARRAY['Mall of arabia', 'Mall of Arabia', 'فرع مول العرب']),
  ('Mall of egypt', ARRAY['Mall of egypt', 'Mall of Egypt', 'فرع مول مصر']),
  ('Madinaty', ARRAY['Madinaty', 'فرع اير مول - مدينتى', 'فرع اير مول - مدينتي', 'فرع مدينتى', 'فرع مدينتي']),
  ('Mivida', ARRAY['Mivida', 'فرع مافيدا', 'فرع مفيدا']),
  ('Bostan Wholesale', ARRAY['Bostan Wholesale', 'فرع البساتين جمله']),
  ('Wholesale Showroom', ARRAY['Wholesale Showroom', 'معارض - جمله']),
  ('Wholesale', ARRAY['Wholesale', 'الجملة']),
  ('Mansoura', ARRAY['Mansoura', 'فرع المنصورة']),
  ('The Hub CFC', ARRAY['The Hub CFC', 'Cairo Festival City', 'ذا هاب - كايرو فيستيفال سيتي']),
  ('Cutting Point', ARRAY['Cutting Point', 'نقطة التقطيع']),
  ('Trivium zayed', ARRAY['Trivium zayed', 'Sheikh Zayed', 'فرع الشيخ زايد']),
  ('Administration', ARRAY['Administration', 'الادارة']),
  ('10th Ramadan Warehouse', ARRAY['10th Ramadan Warehouse', 'مخزن العاشر - تجزئة']),
  ('Showroom', ARRAY['Showroom', 'فرع معارض']),
  ('Tagamoa', ARRAY['Tagamoa', 'Tagamo3', 'التجمع', 'فرع التجمع']),
  ('Zagazig', ARRAY['Zagazig', 'الزقازيق', 'فرع الزقازيق'])
ON CONFLICT (alias_name) DO UPDATE
  SET actual_branches = EXCLUDED.actual_branches,
      updated_at = now();

-- ------------------------------------------------------------
-- 3) Scope expansion + the patched RLS predicate
-- ------------------------------------------------------------

-- Every branch spelling the admin is allowed to see, as normalized keys.
CREATE OR REPLACE FUNCTION public.admin_branch_scope_keys(p_admin_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(array_agg(DISTINCT k), ARRAY[]::text[])
  FROM (
    -- The scope value itself, in case it is already a raw branch string.
    SELECT public.normalize_branch(s.branch_name) AS k
    FROM public.admin_branch_scope s
    WHERE s.admin_user_id = p_admin_id

    UNION ALL

    -- Every variant of the alias group the scope value belongs to.
    SELECT public.normalize_branch(v) AS k
    FROM public.admin_branch_scope s
    JOIN public.branch_aliases ba
      ON public.normalize_branch(ba.alias_name) = public.normalize_branch(s.branch_name)
      OR EXISTS (
        SELECT 1
        FROM unnest(ba.actual_branches) AS a
        WHERE public.normalize_branch(a) = public.normalize_branch(s.branch_name)
      )
    CROSS JOIN unnest(ba.actual_branches) AS v
    WHERE s.admin_user_id = p_admin_id
  ) x
  WHERE k IS NOT NULL AND k <> '';
$$;

GRANT EXECUTE ON FUNCTION public.admin_branch_scope_keys(uuid)
  TO authenticated, anon, service_role;

-- The raw branch strings an admin may see — handy for ad-hoc queries and for
-- anything that needs `branch IN (...)` rather than a per-row predicate.
CREATE OR REPLACE FUNCTION public.admin_actual_branches(p_admin_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(array_agg(DISTINCT b), ARRAY[]::text[])
  FROM (
    SELECT s.branch_name AS b
    FROM public.admin_branch_scope s
    WHERE s.admin_user_id = p_admin_id

    UNION ALL

    SELECT v AS b
    FROM public.admin_branch_scope s
    JOIN public.branch_aliases ba
      ON public.normalize_branch(ba.alias_name) = public.normalize_branch(s.branch_name)
      OR EXISTS (
        SELECT 1
        FROM unnest(ba.actual_branches) AS a
        WHERE public.normalize_branch(a) = public.normalize_branch(s.branch_name)
      )
    CROSS JOIN unnest(ba.actual_branches) AS v
    WHERE s.admin_user_id = p_admin_id
  ) x
  WHERE b IS NOT NULL AND btrim(b) <> '';
$$;

GRANT EXECUTE ON FUNCTION public.admin_actual_branches(uuid)
  TO authenticated, anon, service_role;

-- This is the predicate every scoped-admin RLS policy in
-- ENFORCE-scoped-admin-rls.sql calls. Replacing it fixes orders, clients and
-- salespersons at once — the policies themselves need no change.
CREATE OR REPLACE FUNCTION public.admin_has_branch(p_branch text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT public.normalize_branch(p_branch) = ANY (public.admin_branch_scope_keys(auth.uid()));
$$;

COMMIT;

-- ============================================================
-- Verify (run in the SQL editor)
-- ============================================================
-- The Faisel manager should now resolve to the Arabic branch name:
--   SELECT public.admin_actual_branches(id)
--   FROM public.users WHERE email = 'momen.hamza@nstextile-eg.com';
--
-- Every scoped admin, with how many orders they can now see:
--   SELECT u.email,
--          public.admin_actual_branches(u.id) AS branches,
--          (SELECT count(*) FROM public.orders o
--            WHERE public.normalize_branch(o.branch)
--                  = ANY (public.admin_branch_scope_keys(u.id))) AS visible_orders
--   FROM public.users u
--   WHERE u.role = 'admin'
--     AND COALESCE(u.is_super_admin, false) = false
--     AND EXISTS (SELECT 1 FROM public.admin_branch_scope s WHERE s.admin_user_id = u.id)
--   ORDER BY u.email;
--
-- Any scope value with no alias group (those admins would still see nothing):
--   SELECT DISTINCT s.branch_name
--   FROM public.admin_branch_scope s
--   WHERE NOT EXISTS (
--     SELECT 1 FROM public.branch_aliases ba
--     WHERE public.normalize_branch(ba.alias_name) = public.normalize_branch(s.branch_name)
--        OR EXISTS (SELECT 1 FROM unnest(ba.actual_branches) a
--                   WHERE public.normalize_branch(a) = public.normalize_branch(s.branch_name))
--   );
--
-- Branch values in orders that no alias group covers. Add any real ones to
-- BRANCH_CANONICALS in src/lib/branchAliases.ts, then re-run this file:
--   SELECT o.branch, count(*)
--   FROM public.orders o
--   WHERE o.branch IS NOT NULL
--     AND NOT EXISTS (
--       SELECT 1 FROM public.branch_aliases ba, unnest(ba.actual_branches) a
--       WHERE public.normalize_branch(a) = public.normalize_branch(o.branch)
--     )
--   GROUP BY o.branch ORDER BY 2 DESC;
-- ============================================================
