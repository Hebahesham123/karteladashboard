-- ============================================================
-- SET USER ROLES
-- Run this AFTER creating users via:
--   1. http://localhost:3000/setup  (recommended), OR
--   2. Supabase Dashboard → Authentication → Users → Add User
-- ============================================================

-- Set admin role
UPDATE public.users 
SET role = 'admin', full_name = 'Admin User'
WHERE email = 'admin@cartela.com';

-- Set sales roles
UPDATE public.users 
SET role = 'sales'
WHERE email IN ('sales1@cartela.com', 'sales2@cartela.com');

-- Verify
SELECT id, email, full_name, role, created_at 
FROM public.users 
ORDER BY created_at DESC;
