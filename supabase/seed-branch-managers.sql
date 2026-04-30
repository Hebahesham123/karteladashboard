-- Seed 26 branch managers / deputies as Supabase auth users + admin profiles
-- with branch scope. Default password: 1234
-- Run in Supabase SQL Editor (uses service role).

DO $$
DECLARE
  rec RECORD;
  v_user_id UUID;
  v_existing_id UUID;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('mohammed.samir@nstextile-eg.com',     'محمد سمير محمد على',                  'Azhar 2',         'مدير فرع'),
      ('eslam.yehia@nstextile-eg.com',        'اسلام يحيى عبدالمعطى عبدالحميد',     'Madinaty',        'مدير فرع'),
      ('samy.mahmoud@nstextile-eg.com',       'سامى محمود محمد احمد',               'Faisel',          'مدير فرع'),
      ('muhammad.nabil@nstextile-eg.com',     'محمد نبيل',                          'Helwan',          'مدير فرع'),
      ('yassin.fathy@nstextile-eg.com',       'ياسين فتحي محمد علي حمزه',           'Mall of egypt',   'مدير فرع'),
      ('anter.amr@nstextile-eg.com',          'عنتر عمرو احمد راشد',                'Moskey',          'مدير فرع'),
      ('tamer.elmasry@nstextile-eg.com',      'تامر عبدالعليم عبدالعليم المصرى',    'Hosery',          'مدير فرع'),
      ('islam.ibrahim@nstextile-eg.com',      'ابراهيم كامل محمد يونس',             'Nozha',           'مدير فرع'),
      ('ahmed.magdy.bedir@nstextile-eg.com',  'احمد مجدى بدير',                     'Mall of arabia',  'مدير فرع'),
      ('amr.elshenawy@nstextile-eg.com',      'الشناوى حسن الشناوى بيومى',         'Alexandria',      'مدير فرع'),
      ('tamerali@nstextile-eg.com',           'تامر على عبدالخالق على ابراهيم',     'Moskey',          'نائب مدير فرع'),
      ('roshdy.mohamed@nstextile-eg.com',     'محمد رشدى سيد ابوزيد',               'Trivium zayed',   'مدير فرع'),
      ('haitham.mohammed@nstextile-eg.com',   'هيثم محمد السيد درويش',              'Tagamoa',         'مدير فرع'),
      ('abdelrahmanmagdy@nstextile-eg.com',   'عبدالرحمن مجدى صابر عباس',           'Nasr city',       'مدير فرع'),
      ('moamen.ibrahim@nstextile-eg.com',     'مؤمن ابراهيم على محمد',              'Tagamoa',         'نائب مدير فرع'),
      ('ahmed.saleh@nstextile-eg.com',        'احمد صالح هلال صالح',                'Nozha',           'نائب مدير فرع'),
      ('ahmed.badawi@nstextile-eg.com',       'احمد بدوى زكى سيد',                  'Hosery',          'نائب مدير فرع'),
      ('mohammed.hamouda@nstextile-eg.com',   'محمد حموده ابراهيم عبدالرحيم',       'Kal3a',           'نائب مدير فرع'),
      ('karim.mohamed@nstextile-eg.com',      'كريم محمد محسن عبدالفتاح',           'Azhar 1',         'مدير فرع'),
      ('sherif.abdelmoneim@nstextile-eg.com', 'شريف عبدالمنعم على احمد على',        'Azhar 3',         'نائب مدير فرع'),
      ('mohamed.fakhry@nstextile-eg.com',     'محمد احمد فخري اسماعيل صابر',        'Nasr city',       'نائب مدير فرع'),
      ('aya.hamed@nstextile-eg.com',          'ايه حامد راشد الفيومي',              'Damietta retail', 'نائب مدير فرع'),
      ('momen.hamza@nstextile-eg.com',        'مؤمن عدلى على احمد',                 'Faisel',          'نائب مدير فرع'),
      ('mahmoued.mohamed@nstextile-eg.com',   'محمود محمد عبدالسميع رضوان',         'Tagamoa',         'نائب مدير فرع'),
      ('muhammad.farag@nstextile-eg.com',     'محمد فرج محمود سليمان نوار',         'Alexandria',      'نائب مدير فرع'),
      ('sherif.hassieb@nstextile-eg.com',     'شريف يوسف محمد حسيب',                'Damietta retail', 'مدير فرع')
    ) AS t(email, full_name, branch, title)
  LOOP
    -- Check if auth user already exists
    SELECT id INTO v_existing_id FROM auth.users WHERE email = rec.email LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      v_user_id := v_existing_id;
      -- Reset password to '1234' and confirm email
      UPDATE auth.users
      SET encrypted_password = crypt('1234', gen_salt('bf')),
          email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
          updated_at = NOW(),
          raw_user_meta_data = jsonb_build_object(
            'full_name', rec.full_name,
            'role', 'admin',
            'title', rec.title,
            'branch', rec.branch
          )
      WHERE id = v_user_id;
    ELSE
      v_user_id := gen_random_uuid();
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change,
        email_change_token_new, recovery_token
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        v_user_id,
        'authenticated',
        'authenticated',
        rec.email,
        crypt('1234', gen_salt('bf')),
        NOW(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object(
          'full_name', rec.full_name,
          'role', 'admin',
          'title', rec.title,
          'branch', rec.branch
        ),
        NOW(), NOW(), '', '', '', ''
      );

      -- Required identity row so password login works
      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        v_user_id,
        jsonb_build_object('sub', v_user_id::text, 'email', rec.email),
        'email',
        rec.email,
        NOW(), NOW(), NOW()
      );
    END IF;

    -- Upsert public profile
    INSERT INTO public.users (id, email, full_name, role, is_active, is_super_admin)
    VALUES (v_user_id, rec.email, rec.full_name, 'admin', TRUE, FALSE)
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          full_name = EXCLUDED.full_name,
          role = 'admin',
          is_active = TRUE,
          updated_at = NOW();

    -- Replace branch scope (single branch per user)
    DELETE FROM public.admin_branch_scope WHERE admin_user_id = v_user_id;
    INSERT INTO public.admin_branch_scope (admin_user_id, branch_name)
    VALUES (v_user_id, rec.branch);

    -- Rebuild salesperson scope from orders matching the branch
    DELETE FROM public.admin_salesperson_scope WHERE admin_user_id = v_user_id;
    INSERT INTO public.admin_salesperson_scope (admin_user_id, salesperson_id)
    SELECT DISTINCT v_user_id, o.salesperson_id
    FROM public.orders o
    WHERE o.branch ILIKE rec.branch
      AND o.salesperson_id IS NOT NULL;
  END LOOP;
END $$;

-- Verify
SELECT u.email, u.full_name, abs.branch_name
FROM public.users u
JOIN public.admin_branch_scope abs ON abs.admin_user_id = u.id
WHERE u.email LIKE '%@nstextile-eg.com'
ORDER BY abs.branch_name, u.full_name;
