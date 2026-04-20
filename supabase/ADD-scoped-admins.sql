-- ============================================================
-- Scoped Admins (keep role=admin, but limit data by scope)
-- ============================================================
-- Run in Supabase SQL editor first, then use API route:
--   POST /api/admin/create-area-admins
-- ============================================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.admin_salesperson_scope (
  admin_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  salesperson_id uuid NOT NULL REFERENCES public.salespersons(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_user_id, salesperson_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_salesperson_scope_admin
  ON public.admin_salesperson_scope(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_salesperson_scope_salesperson
  ON public.admin_salesperson_scope(salesperson_id);

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.admin_salesperson_scope
TO authenticated, anon;

COMMIT;

-- Optional checks:
-- SELECT email, role, is_super_admin FROM public.users ORDER BY created_at DESC;
-- SELECT admin_user_id, COUNT(*) FROM public.admin_salesperson_scope GROUP BY admin_user_id;
