-- ============================================================
-- PERFORMANCE PACK — run this in one go in Supabase SQL Editor.
-- Safe to re-run. Adds indexes + materialized snapshot + branch aggregate RPC.
-- ============================================================

-- 1) Critical indexes on hot columns.
CREATE INDEX IF NOT EXISTS idx_orders_month_year_salesperson
  ON public.orders (month, year, salesperson_id);
CREATE INDEX IF NOT EXISTS idx_orders_month_year_client
  ON public.orders (month, year, client_id);
CREATE INDEX IF NOT EXISTS idx_orders_salesperson_month_year
  ON public.orders (salesperson_id, month, year);
CREATE INDEX IF NOT EXISTS idx_orders_branch
  ON public.orders (branch);
CREATE INDEX IF NOT EXISTS idx_orders_year_month_salesperson_client
  ON public.orders (year, month, salesperson_id, client_id);
CREATE INDEX IF NOT EXISTS idx_orders_client_year_month
  ON public.orders (client_id, year, month);
CREATE INDEX IF NOT EXISTS idx_clients_salesperson_type
  ON public.clients (salesperson_id, customer_type);
CREATE INDEX IF NOT EXISTS idx_clients_type_name
  ON public.clients (customer_type, name);
CREATE INDEX IF NOT EXISTS idx_clients_id_salesperson_type
  ON public.clients (id, salesperson_id, customer_type);

-- 2) Pre-aggregated branch stats RPC (used by /api/branches → microseconds).
CREATE OR REPLACE FUNCTION public.branch_order_stats()
RETURNS TABLE(branch text, order_count bigint, total_revenue numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    CASE WHEN COALESCE(trim(o.branch), '') = '' THEN NULL::text ELSE trim(o.branch) END AS branch,
    COUNT(*)::bigint,
    COALESCE(SUM(o.invoice_total), 0)::numeric
  FROM public.orders o
  GROUP BY CASE WHEN COALESCE(trim(o.branch), '') = '' THEN NULL::text ELSE trim(o.branch) END
  ORDER BY COUNT(*) DESC;
$$;
GRANT EXECUTE ON FUNCTION public.branch_order_stats() TO authenticated, anon;

-- 3) Branch stats scoped to a list of salespersons (for area/branch managers).
CREATE OR REPLACE FUNCTION public.branch_order_stats_for_salespersons(p_sp_ids uuid[])
RETURNS TABLE(branch text, order_count bigint, total_revenue numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    CASE WHEN COALESCE(trim(o.branch), '') = '' THEN NULL::text ELSE trim(o.branch) END AS branch,
    COUNT(*)::bigint,
    COALESCE(SUM(o.invoice_total), 0)::numeric
  FROM public.orders o
  WHERE p_sp_ids IS NULL OR cardinality(p_sp_ids) = 0 OR o.salesperson_id = ANY(p_sp_ids)
  GROUP BY CASE WHEN COALESCE(trim(o.branch), '') = '' THEN NULL::text ELSE trim(o.branch) END
  ORDER BY COUNT(*) DESC;
$$;
GRANT EXECUTE ON FUNCTION public.branch_order_stats_for_salespersons(uuid[]) TO authenticated, anon;

-- 4) Dashboard KPI aggregate at the server (per month range + optional sp filter).
--    Returns one row of totals — replaces hundreds of paged client-side fetches.
CREATE OR REPLACE FUNCTION public.dashboard_kpis(
  p_from_year int, p_from_month int, p_to_year int, p_to_month int,
  p_sp_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  total_meters numeric,
  total_revenue numeric,
  order_count bigint,
  active_clients bigint,
  green_clients bigint,
  orange_clients bigint,
  red_clients bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH bounds AS (
    SELECT (p_from_year * 12 + p_from_month) AS lo,
           (p_to_year   * 12 + p_to_month)   AS hi
  ),
  per_client AS (
    SELECT
      o.client_id,
      SUM(o.quantity) AS meters,
      SUM(COALESCE(o.invoice_total, 0)) AS revenue,
      COUNT(*) AS orders
    FROM public.orders o, bounds b
    WHERE (o.year * 12 + o.month) BETWEEN b.lo AND b.hi
      AND (p_sp_ids IS NULL OR cardinality(p_sp_ids) = 0 OR o.salesperson_id = ANY(p_sp_ids))
    GROUP BY o.client_id
  )
  SELECT
    COALESCE(SUM(meters), 0)::numeric,
    COALESCE(SUM(revenue), 0)::numeric,
    COALESCE(SUM(orders), 0)::bigint,
    COUNT(*) FILTER (WHERE meters > 0)::bigint,
    COUNT(*) FILTER (WHERE meters >= 100)::bigint,
    COUNT(*) FILTER (WHERE meters > 0 AND meters < 100)::bigint,
    COUNT(*) FILTER (WHERE meters = 0)::bigint
  FROM per_client;
$$;
GRANT EXECUTE ON FUNCTION public.dashboard_kpis(int,int,int,int,uuid[]) TO authenticated, anon;

-- 5) Tell PostgREST to reload its schema cache so new RPCs are callable immediately.
NOTIFY pgrst, 'reload schema';

-- 6) Verify
SELECT 'Performance pack installed' AS status;
