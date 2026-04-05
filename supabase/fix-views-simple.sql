-- ============================================================
-- SIMPLE FIX — Run this if fix-complete.sql caused problems
-- This version is simpler and more reliable
-- Run in: Supabase → SQL Editor → Paste → Run
-- ============================================================

-- STEP 1: Backfill salesperson_id on clients from orders
UPDATE public.clients c
SET salesperson_id = (
  SELECT o.salesperson_id
  FROM   public.orders o
  WHERE  o.client_id       = c.id
    AND  o.salesperson_id IS NOT NULL
  ORDER  BY o.year DESC, o.month DESC
  LIMIT  1
)
WHERE c.salesperson_id IS NULL;

-- ============================================================
-- STEP 2: client_monthly_metrics (simple + reliable)
-- ============================================================
DROP VIEW IF EXISTS public.client_monthly_metrics CASCADE;

CREATE VIEW public.client_monthly_metrics AS
WITH order_summary AS (
  SELECT
    o.client_id,
    o.month,
    o.year,
    SUM(o.quantity)                AS total_meters,
    COUNT(DISTINCT o.product_id)   AS unique_products,

    -- Primary salesperson for this month
    (
      SELECT o2.salesperson_id
      FROM   public.orders o2
      WHERE  o2.client_id      = o.client_id
        AND  o2.month          = o.month
        AND  o2.year           = o.year
        AND  o2.salesperson_id IS NOT NULL
      GROUP  BY o2.salesperson_id
      ORDER  BY SUM(o2.quantity) DESC
      LIMIT  1
    ) AS primary_salesperson_id,

    -- Top product by quantity this month
    (
      SELECT p.name
      FROM   public.orders o3
      JOIN   public.products p ON p.id = o3.product_id
      WHERE  o3.client_id = o.client_id
        AND  o3.month     = o.month
        AND  o3.year      = o.year
      GROUP  BY p.name
      ORDER  BY SUM(o3.quantity) DESC
      LIMIT  1
    ) AS top_product_name

  FROM public.orders o
  GROUP BY o.client_id, o.month, o.year
)
SELECT
  c.id                                                          AS client_id,
  c.name                                                        AS client_name,
  c.partner_id,
  c.current_status,
  COALESCE(c.salesperson_id, os.primary_salesperson_id)         AS salesperson_id,
  COALESCE(csp.name,         psp.name)                          AS salesperson_name,
  COALESCE(csp.code,         psp.code)                          AS salesperson_code,
  os.month,
  os.year,
  COALESCE(os.total_meters,    0)                               AS total_meters,
  COALESCE(os.unique_products, 0)                               AS unique_products,
  os.top_product_name,

  -- Cartela columns (set to 0/null — safe defaults)
  0                                                             AS cartela_count,
  0                                                             AS top_product_cartela,
  NULL::INT                                                     AS kartela_month,
  NULL::INT                                                     AS kartela_year,
  FALSE                                                         AS kartela_cross_month,

  CASE
    WHEN COALESCE(os.total_meters, 0) = 0   THEN 'RED'
    WHEN COALESCE(os.total_meters, 0) < 100 THEN 'ORANGE'
    ELSE                                         'GREEN'
  END                                                           AS level

FROM       public.clients       c
JOIN       order_summary        os  ON  c.id              = os.client_id
LEFT JOIN  public.salespersons  csp ON  c.salesperson_id  = csp.id
LEFT JOIN  public.salespersons  psp ON  os.primary_salesperson_id = psp.id;

-- ============================================================
-- STEP 3: product_analytics (with salesperson_id support)
-- ============================================================
DROP VIEW IF EXISTS public.product_analytics CASCADE;

CREATE VIEW public.product_analytics AS

-- Overall totals (no salesperson filter) — use .is("salesperson_id", null)
SELECT
  p.id                              AS product_id,
  p.name                            AS product_name,
  o.month,
  o.year,
  NULL::UUID                        AS salesperson_id,
  COUNT(DISTINCT o.client_id)       AS unique_clients,
  COALESCE(SUM(o.quantity), 0)      AS total_meters,
  COALESCE(AVG(o.quantity), 0)      AS avg_meters_per_order,
  COUNT(*)                          AS order_count
FROM public.products p
LEFT JOIN public.orders o ON p.id = o.product_id
GROUP BY p.id, p.name, o.month, o.year

UNION ALL

-- Per-salesperson — use .eq("salesperson_id", uuid)
SELECT
  p.id                              AS product_id,
  p.name                            AS product_name,
  o.month,
  o.year,
  o.salesperson_id,
  COUNT(DISTINCT o.client_id)       AS unique_clients,
  COALESCE(SUM(o.quantity), 0)      AS total_meters,
  COALESCE(AVG(o.quantity), 0)      AS avg_meters_per_order,
  COUNT(*)                          AS order_count
FROM public.products p
JOIN  public.orders o ON p.id = o.product_id
WHERE o.salesperson_id IS NOT NULL
GROUP BY p.id, p.name, o.month, o.year, o.salesperson_id;

-- ============================================================
-- STEP 4: salesperson_performance (unchanged but re-created)
-- ============================================================
DROP VIEW IF EXISTS public.salesperson_performance CASCADE;

CREATE VIEW public.salesperson_performance AS
SELECT
  sp.id                              AS salesperson_id,
  sp.name                            AS salesperson_name,
  sp.code                            AS salesperson_code,
  o.month,
  o.year,
  COUNT(DISTINCT o.client_id)        AS active_clients,
  COALESCE(SUM(o.quantity), 0)       AS total_meters,
  COUNT(DISTINCT o.product_id)       AS unique_products
FROM public.salespersons sp
LEFT JOIN public.orders o ON sp.id = o.salesperson_id
GROUP BY sp.id, sp.name, sp.code, o.month, o.year;

-- ============================================================
-- STEP 5: get_dashboard_stats RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(
  p_year            INT  DEFAULT NULL,
  p_month           INT  DEFAULT NULL,
  p_salesperson_id  UUID DEFAULT NULL
)
RETURNS TABLE (
  total_meters    NUMERIC,
  unique_clients  BIGINT,
  green_clients   BIGINT,
  orange_clients  BIGINT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH client_totals AS (
    SELECT client_id, SUM(total_meters) AS total_m
    FROM   public.client_monthly_metrics
    WHERE  (p_year  IS NULL OR year  = p_year)
      AND  (p_month IS NULL OR month = p_month)
      AND  (p_salesperson_id IS NULL OR salesperson_id = p_salesperson_id)
    GROUP  BY client_id
  )
  SELECT
    COALESCE(SUM(total_m),   0)                            AS total_meters,
    COUNT(*)                                               AS unique_clients,
    COUNT(*) FILTER (WHERE total_m >= 100)                 AS green_clients,
    COUNT(*) FILTER (WHERE total_m > 0 AND total_m < 100)  AS orange_clients
  FROM client_totals;
$$;

-- ============================================================
-- STEP 6: Grant permissions to authenticated users
-- ============================================================
GRANT SELECT ON public.client_monthly_metrics    TO authenticated, anon;
GRANT SELECT ON public.product_analytics         TO authenticated, anon;
GRANT SELECT ON public.salesperson_performance   TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats TO authenticated, anon;

-- ============================================================
-- VERIFY — check rows returned
-- ============================================================
SELECT 'client_monthly_metrics' AS check_name, COUNT(*) AS row_count
FROM public.client_monthly_metrics
UNION ALL
SELECT 'product_analytics (overall)', COUNT(*)
FROM public.product_analytics WHERE salesperson_id IS NULL
UNION ALL
SELECT 'salesperson_performance', COUNT(*)
FROM public.salesperson_performance
WHERE total_meters > 0;
