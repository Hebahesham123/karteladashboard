-- ============================================================
-- Scope change (requested 2026-08-09)
-- ============================================================
--   Youssef Ramzy — youssef.ramzy@nstextile-eg.com  (area manager)
--     KEEPS  Southgate, Madinaty, Mivida
--     ADDS   Mall of Arabia (مول العرب), Mall of Egypt (مول مصر),
--            Sheikh Zayed  (الشيخ زايد — canonical name "Trivium zayed")
--
--   Eslam Mohamed Gamal — eslam.gamal@gmail.com  (branch manager)
--     REMOVES Nasr city (مدينة نصر)
--     ADDS    Azhar 2   (الازهر 2)
--
-- Branch scope is stored as CANONICAL ENGLISH names (same as
-- /api/admin/create-area-admins writes); the app maps them to the real
-- Arabic strings in orders.branch via src/lib/branchAliases.ts.
--
-- Salesperson scope is rebuilt by matching orders.branch with ILIKE
-- substring patterns — the same trick fix-branch-manager-scope.sql uses to
-- dodge Unicode normalization mismatches on pasted Arabic. This matters:
-- resolveAdminScope() reads admin_salesperson_scope FIRST, so a branch added
-- without its salespersons would show the user nothing.
--
-- Safe to re-run. Does NOT touch passwords or any other user.
-- Run in the Supabase SQL Editor.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_ramzy uuid;
  v_gamal uuid;
  v_n     int;
BEGIN
  SELECT id INTO v_ramzy FROM public.users
   WHERE lower(email) = lower('youssef.ramzy@nstextile-eg.com') LIMIT 1;
  SELECT id INTO v_gamal FROM public.users
   WHERE lower(email) = lower('eslam.gamal@gmail.com') LIMIT 1;

  IF v_ramzy IS NULL THEN
    RAISE EXCEPTION 'User not found: youssef.ramzy@nstextile-eg.com';
  END IF;
  IF v_gamal IS NULL THEN
    RAISE EXCEPTION 'User not found: eslam.gamal@gmail.com';
  END IF;

  -- ─────────────────────────────────────────────────────────
  -- 1) Youssef Ramzy — ADD ONLY. Existing branches stay put.
  -- ─────────────────────────────────────────────────────────
  INSERT INTO public.admin_branch_scope (admin_user_id, branch_name)
  VALUES (v_ramzy, 'Mall of arabia'),
         (v_ramzy, 'Mall of egypt'),
         (v_ramzy, 'Trivium zayed')
  ON CONFLICT DO NOTHING;

  -- Add the salespersons of the three new branches; keep the ones he has.
  INSERT INTO public.admin_salesperson_scope (admin_user_id, salesperson_id)
  SELECT DISTINCT v_ramzy, o.salesperson_id
  FROM public.orders o
  WHERE o.salesperson_id IS NOT NULL
    AND (   o.branch ILIKE '%مول العرب%'
         OR o.branch ILIKE '%مول مصر%'
         OR o.branch ILIKE '%شيخ زايد%'
         OR o.branch ILIKE '%mall of arab%'
         OR o.branch ILIKE '%mall of egypt%'
         OR o.branch ILIKE '%zayed%')
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Youssef Ramzy: +% salespersons from the 3 new branches', v_n;

  -- ─────────────────────────────────────────────────────────
  -- 2) Eslam Gamal — swap Nasr city for Azhar 2.
  --    Matches both the canonical English row and the exact Arabic row,
  --    because different seed scripts wrote it in different forms.
  -- ─────────────────────────────────────────────────────────
  DELETE FROM public.admin_branch_scope
  WHERE admin_user_id = v_gamal
    AND (branch_name ILIKE '%مدينة نصر%' OR branch_name ILIKE '%nasr%');

  INSERT INTO public.admin_branch_scope (admin_user_id, branch_name)
  VALUES (v_gamal, 'Azhar 2')
  ON CONFLICT DO NOTHING;

  -- Single-branch manager: full rebuild is correct and drops the Nasr city reps.
  DELETE FROM public.admin_salesperson_scope WHERE admin_user_id = v_gamal;

  INSERT INTO public.admin_salesperson_scope (admin_user_id, salesperson_id)
  SELECT DISTINCT v_gamal, o.salesperson_id
  FROM public.orders o
  WHERE o.salesperson_id IS NOT NULL
    AND (o.branch ILIKE '%زهر%2%' OR o.branch ILIKE '%azhar%2%')
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Eslam Gamal: % salespersons on Azhar 2', v_n;

  IF v_n = 0 THEN
    RAISE WARNING 'No Azhar 2 salespersons matched — Eslam Gamal would see nothing. Check the branch strings with the query at the bottom of this file.';
  END IF;
END $$;

COMMIT;

-- ── Verify: branch scope + how many reps each branch pulled in ────────────
SELECT
  u.email,
  u.full_name,
  abs.branch_name,
  (SELECT COUNT(*) FROM public.admin_salesperson_scope s
    WHERE s.admin_user_id = u.id) AS scoped_salespersons
FROM public.users u
JOIN public.admin_branch_scope abs ON abs.admin_user_id = u.id
WHERE lower(u.email) IN ('youssef.ramzy@nstextile-eg.com', 'eslam.gamal@gmail.com')
ORDER BY u.email, abs.branch_name;

-- ── If a branch matched nothing, list the real strings to fix the pattern ──
-- SELECT branch, COUNT(*) FROM public.orders
-- WHERE branch IS NOT NULL GROUP BY branch ORDER BY COUNT(*) DESC;
