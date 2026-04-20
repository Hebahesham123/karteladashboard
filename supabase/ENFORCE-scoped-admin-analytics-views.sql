-- ============================================================
-- Enforce scoped access on analytics views used by all pages
-- ============================================================
-- Run after:
--   1) ADD-scoped-admins.sql
--   2) ADD-admin-branch-scope.sql
--   3) ENFORCE-scoped-admin-rls.sql
--   4) OPTIMIZE-materialized-analytics.sql / REGENERATE scripts
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.can_access_salesperson(p_salesperson_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    CASE
      WHEN p_salesperson_id IS NULL THEN false
      WHEN public.get_user_role() = 'sales' THEN p_salesperson_id = public.get_salesperson_id()
      WHEN public.get_user_role() = 'admin' THEN
        public.is_super_admin()
        OR public.admin_has_salesperson(p_salesperson_id)
        OR EXISTS (
          SELECT 1
          FROM public.orders o
          JOIN public.admin_branch_scope bs
            ON lower(trim(coalesce(o.branch, ''))) = lower(trim(bs.branch_name))
          WHERE bs.admin_user_id = auth.uid()
            AND o.salesperson_id = p_salesperson_id
          LIMIT 1
        )
      ELSE false
    END;
$$;

CREATE OR REPLACE FUNCTION public.admin_has_branch_scope()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_branch_scope bs
    WHERE bs.admin_user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_branch(p_branch text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    CASE
      WHEN public.get_user_role() = 'admin' THEN
        public.is_super_admin()
        OR EXISTS (
          SELECT 1
          FROM public.admin_branch_scope bs
          WHERE bs.admin_user_id = auth.uid()
            AND lower(trim(coalesce(bs.branch_name, ''))) = lower(trim(coalesce(p_branch, '')))
        )
      ELSE false
    END;
$$;

-- client_monthly_metrics wrapper (filters rows by allowed salesperson)
CREATE OR REPLACE VIEW public.client_monthly_metrics AS
SELECT *
FROM public.client_monthly_metrics_mv c
WHERE
  CASE
    WHEN public.get_user_role() = 'admin' AND public.admin_has_branch_scope() THEN
      EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.client_id = c.client_id
          AND o.month = c.month
          AND o.year = c.year
          AND public.can_access_branch(o.branch)
      )
    ELSE public.can_access_salesperson(c.salesperson_id)
  END;

-- salesperson_performance wrapper
CREATE OR REPLACE VIEW public.salesperson_performance AS
SELECT *
FROM public.salesperson_performance_mv s
WHERE
  CASE
    WHEN public.get_user_role() = 'admin' AND public.admin_has_branch_scope() THEN
      EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.salesperson_id = s.salesperson_id
          AND o.month = s.month
          AND o.year = s.year
          AND public.can_access_branch(o.branch)
      )
    ELSE public.can_access_salesperson(s.salesperson_id)
  END;

-- product_analytics wrapper:
-- - keep detailed salesperson rows (for sp-specific filters)
-- - for "all salespersons" view in scoped users, provide a scoped aggregate with salesperson_id = NULL
CREATE OR REPLACE VIEW public.product_analytics AS
WITH scoped_detail AS (
  SELECT
    p.product_id,
    p.product_name,
    p.month,
    p.year,
    p.salesperson_id,
    p.unique_clients,
    p.total_meters,
    p.total_revenue,
    p.avg_meters_per_order,
    p.order_count
  FROM public.product_analytics_mv p
  WHERE p.salesperson_id IS NOT NULL
    AND (
      CASE
        WHEN public.get_user_role() = 'admin' AND public.admin_has_branch_scope() THEN
          EXISTS (
            SELECT 1
            FROM public.orders o
            WHERE o.product_id = p.product_id
              AND o.salesperson_id = p.salesperson_id
              AND o.month = p.month
              AND o.year = p.year
              AND public.can_access_branch(o.branch)
          )
        ELSE public.can_access_salesperson(p.salesperson_id)
      END
    )
),
scoped_aggregate AS (
  SELECT
    product_id,
    product_name,
    month,
    year,
    NULL::uuid AS salesperson_id,
    MAX(unique_clients)::bigint AS unique_clients,
    SUM(total_meters) AS total_meters,
    SUM(total_revenue) AS total_revenue,
    AVG(avg_meters_per_order) AS avg_meters_per_order,
    SUM(order_count)::bigint AS order_count
  FROM scoped_detail
  GROUP BY product_id, product_name, month, year
)
SELECT
  p.product_id,
  p.product_name,
  p.month,
  p.year,
  p.salesperson_id,
  p.unique_clients,
  p.total_meters,
  p.total_revenue,
  p.avg_meters_per_order,
  p.order_count
FROM public.product_analytics_mv p
WHERE public.is_super_admin()
UNION ALL
SELECT
  a.product_id,
  a.product_name,
  a.month,
  a.year,
  a.salesperson_id,
  a.unique_clients,
  a.total_meters,
  a.total_revenue,
  a.avg_meters_per_order,
  a.order_count
FROM scoped_aggregate a
WHERE NOT public.is_super_admin()
UNION ALL
SELECT
  d.product_id,
  d.product_name,
  d.month,
  d.year,
  d.salesperson_id,
  d.unique_clients,
  d.total_meters,
  d.total_revenue,
  d.avg_meters_per_order,
  d.order_count
FROM scoped_detail d
WHERE NOT public.is_super_admin();

GRANT SELECT ON public.client_monthly_metrics TO authenticated, anon;
GRANT SELECT ON public.salesperson_performance TO authenticated, anon;
GRANT SELECT ON public.product_analytics TO authenticated, anon;

COMMIT;
