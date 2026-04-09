-- Allow sales users to SELECT orders for clients assigned to them, even when
-- orders.salesperson_id is another rep (Odoo invoice lines). Combines with existing
-- policy via OR so both match.
-- Run once in Supabase SQL Editor.

CREATE POLICY "Sales can view orders for assigned clients"
ON public.orders
FOR SELECT
USING (
  public.get_user_role() = 'sales'
  AND EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = orders.client_id
      AND c.salesperson_id = public.get_salesperson_id()
  )
);
