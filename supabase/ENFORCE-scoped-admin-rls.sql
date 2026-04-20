-- ============================================================
-- Enforce scoped admins across core tables
-- ============================================================
-- Run after:
--   1) ADD-scoped-admins.sql
--   2) ADD-admin-branch-scope.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE((
    SELECT u.is_super_admin
    FROM public.users u
    WHERE u.id = auth.uid()
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.admin_has_salesperson(p_salesperson_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_salesperson_scope s
    WHERE s.admin_user_id = auth.uid()
      AND s.salesperson_id = p_salesperson_id
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_has_branch_scope()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_branch_scope s
    WHERE s.admin_user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_has_branch(p_branch text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_branch_scope s
    WHERE s.admin_user_id = auth.uid()
      AND lower(trim(coalesce(s.branch_name, ''))) = lower(trim(coalesce(p_branch, '')))
  );
$$;

-- Read client salesperson without triggering clients->orders->clients RLS recursion.
CREATE OR REPLACE FUNCTION public.client_salesperson_id_unscoped(p_client_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT c.salesperson_id
  FROM public.clients c
  WHERE c.id = p_client_id
  LIMIT 1;
$$;

DROP POLICY IF EXISTS "Admins can see all clients" ON public.clients;
DROP POLICY IF EXISTS "Admins can manage all orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can manage salespersons" ON public.salespersons;
DROP POLICY IF EXISTS "Admins can manage scoped clients" ON public.clients;
DROP POLICY IF EXISTS "Admins can manage scoped orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can manage scoped salespersons" ON public.salespersons;

CREATE POLICY "Admins can manage scoped clients" ON public.clients
  FOR ALL
  USING (
    public.get_user_role() = 'admin' AND
    (
      public.is_super_admin()
      OR (
        public.admin_has_branch_scope()
        AND EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.client_id = clients.id
            AND public.admin_has_branch(o.branch)
        )
      )
      OR (
        NOT public.admin_has_branch_scope()
        AND salesperson_id IS NOT NULL
        AND public.admin_has_salesperson(salesperson_id)
      )
    )
  )
  WITH CHECK (
    public.get_user_role() = 'admin' AND
    (
      public.is_super_admin()
      OR (
        public.admin_has_branch_scope()
        AND (
          EXISTS (
            SELECT 1
            FROM public.orders o
            WHERE o.client_id = clients.id
              AND public.admin_has_branch(o.branch)
          )
          OR (
            salesperson_id IS NOT NULL
            AND public.admin_has_salesperson(salesperson_id)
          )
        )
      )
      OR (
        NOT public.admin_has_branch_scope()
        AND salesperson_id IS NOT NULL
        AND public.admin_has_salesperson(salesperson_id)
      )
    )
  );

CREATE POLICY "Admins can manage scoped orders" ON public.orders
  FOR ALL
  USING (
    public.get_user_role() = 'admin' AND
    (
      public.is_super_admin()
      OR (
        public.admin_has_branch_scope()
        AND public.admin_has_branch(orders.branch)
      )
      OR (
        NOT public.admin_has_branch_scope()
        AND (
          (salesperson_id IS NOT NULL AND public.admin_has_salesperson(salesperson_id))
          OR (
            salesperson_id IS NULL
            AND public.admin_has_salesperson(public.client_salesperson_id_unscoped(orders.client_id))
          )
        )
      )
    )
  )
  WITH CHECK (
    public.get_user_role() = 'admin' AND
    (
      public.is_super_admin()
      OR (
        public.admin_has_branch_scope()
        AND public.admin_has_branch(orders.branch)
      )
      OR (
        NOT public.admin_has_branch_scope()
        AND (
          (salesperson_id IS NOT NULL AND public.admin_has_salesperson(salesperson_id))
          OR (
            salesperson_id IS NULL
            AND public.admin_has_salesperson(public.client_salesperson_id_unscoped(orders.client_id))
          )
        )
      )
    )
  );

CREATE POLICY "Admins can manage scoped salespersons" ON public.salespersons
  FOR ALL
  USING (
    public.get_user_role() = 'admin' AND
    (
      public.is_super_admin()
      OR (
        public.admin_has_branch_scope()
        AND EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.salesperson_id = salespersons.id
            AND public.admin_has_branch(o.branch)
        )
      )
      OR (
        NOT public.admin_has_branch_scope()
        AND public.admin_has_salesperson(id)
      )
    )
  )
  WITH CHECK (
    public.get_user_role() = 'admin' AND
    (
      public.is_super_admin()
      OR (
        public.admin_has_branch_scope()
        AND EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.salesperson_id = salespersons.id
            AND public.admin_has_branch(o.branch)
        )
      )
      OR (
        NOT public.admin_has_branch_scope()
        AND public.admin_has_salesperson(id)
      )
    )
  );

COMMIT;
