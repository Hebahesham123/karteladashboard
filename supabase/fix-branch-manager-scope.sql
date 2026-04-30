-- Map each branch manager to the EXACT branch string used in public.orders
-- by looking it up via a substring pattern (avoids Unicode normalization
-- mismatches between pasted Arabic and stored values).
-- Safe to re-run.

DO $$
DECLARE
  rec RECORD;
  v_user_id UUID;
  v_branch TEXT;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      -- email,                                    pattern (LIKE) used to find the real branch in orders
      ('mohammed.samir@nstextile-eg.com',     '%زهر2%'),
      ('karim.mohamed@nstextile-eg.com',      '%زهر2%'),       -- no Azhar 1 in orders; fallback
      ('sherif.abdelmoneim@nstextile-eg.com', '%زهر3%'),
      ('eslam.yehia@nstextile-eg.com',        '%مدينت%'),
      ('samy.mahmoud@nstextile-eg.com',       '%فيصل%'),
      ('momen.hamza@nstextile-eg.com',        '%فيصل%'),
      ('muhammad.nabil@nstextile-eg.com',     '%حلوان%'),
      ('yassin.fathy@nstextile-eg.com',       '%مول مصر%'),
      ('anter.amr@nstextile-eg.com',          '%موسك%'),
      ('tamerali@nstextile-eg.com',           '%موسك%'),
      ('tamer.elmasry@nstextile-eg.com',      '%حصر%'),
      ('ahmed.badawi@nstextile-eg.com',       '%حصر%'),
      ('islam.ibrahim@nstextile-eg.com',      '%نزه%'),
      ('ahmed.saleh@nstextile-eg.com',        '%نزه%'),
      ('ahmed.magdy.bedir@nstextile-eg.com',  '%مول العرب%'),
      ('amr.elshenawy@nstextile-eg.com',      '%سكندر%'),
      ('muhammad.farag@nstextile-eg.com',     '%سكندر%'),
      ('roshdy.mohamed@nstextile-eg.com',     '%شيخ زايد%'),
      ('haitham.mohammed@nstextile-eg.com',   '%تجمع%'),
      ('moamen.ibrahim@nstextile-eg.com',     '%تجمع%'),
      ('mahmoued.mohamed@nstextile-eg.com',   '%تجمع%'),
      ('abdelrahmanmagdy@nstextile-eg.com',   '%مدينة نصر%'),
      ('mohamed.fakhry@nstextile-eg.com',     '%مدينة نصر%'),
      ('mohammed.hamouda@nstextile-eg.com',   '%قلع%'),
      ('aya.hamed@nstextile-eg.com',          '%دمياط%تجزئة%'),
      ('sherif.hassieb@nstextile-eg.com',     '%دمياط%تجزئة%')
    ) AS t(email, pattern)
  LOOP
    SELECT id INTO v_user_id FROM public.users WHERE email = rec.email LIMIT 1;
    IF v_user_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Pick the branch with the most orders matching the pattern
    SELECT o.branch INTO v_branch
    FROM public.orders o
    WHERE o.branch ILIKE rec.pattern
      AND o.branch IS NOT NULL
    GROUP BY o.branch
    ORDER BY COUNT(*) DESC
    LIMIT 1;

    IF v_branch IS NULL THEN
      RAISE NOTICE 'No matching branch in orders for % (pattern %)', rec.email, rec.pattern;
      CONTINUE;
    END IF;

    -- Replace branch scope (single branch per user, exact byte match)
    DELETE FROM public.admin_branch_scope WHERE admin_user_id = v_user_id;
    INSERT INTO public.admin_branch_scope (admin_user_id, branch_name)
    VALUES (v_user_id, v_branch);

    -- Rebuild salesperson scope from real orders
    DELETE FROM public.admin_salesperson_scope WHERE admin_user_id = v_user_id;
    INSERT INTO public.admin_salesperson_scope (admin_user_id, salesperson_id)
    SELECT DISTINCT v_user_id, o.salesperson_id
    FROM public.orders o
    WHERE o.branch = v_branch
      AND o.salesperson_id IS NOT NULL;
  END LOOP;
END $$;

-- Verify
SELECT
  u.email,
  abs.branch_name,
  (SELECT COUNT(*) FROM public.admin_salesperson_scope s WHERE s.admin_user_id = u.id) AS scoped_salespersons,
  (SELECT COUNT(*) FROM public.orders o WHERE o.branch = abs.branch_name) AS orders_in_branch
FROM public.users u
JOIN public.admin_branch_scope abs ON abs.admin_user_id = u.id
WHERE u.email LIKE '%@nstextile-eg.com'
ORDER BY abs.branch_name, u.email;
