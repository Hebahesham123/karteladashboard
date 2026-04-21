-- Grant full access (all branches / all data) to admin@cartela.com
-- Run this in Supabase SQL editor.
BEGIN;

DO $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Resolve auth user id by email (case-insensitive).
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower('admin@cartela.com')
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Auth user not found for email %', 'admin@cartela.com';
  END IF;

  -- Ensure app profile is admin + super admin.
  UPDATE public.users
  SET role = 'admin',
      is_super_admin = true
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    INSERT INTO public.users (id, role, is_super_admin)
    VALUES (v_user_id, 'admin', true);
  END IF;

  -- Optional cleanup: remove scoped mappings so nothing can accidentally constrain this account.
  DELETE FROM public.admin_branch_scope WHERE admin_user_id = v_user_id;
  DELETE FROM public.admin_salesperson_scope WHERE admin_user_id = v_user_id;
END $$;

COMMIT;
