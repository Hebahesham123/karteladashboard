-- Hotfix: break clients<->orders RLS recursion causing:
-- "infinite recursion detected in policy for relation 'clients'"
BEGIN;

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

DROP POLICY IF EXISTS "Admins can manage scoped orders" ON public.orders;

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

COMMIT;
