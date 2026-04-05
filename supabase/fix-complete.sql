-- ============================================================
-- COMPLETE FIX — Run this ONE file in Supabase SQL Editor
-- Fixes:
--   1. client_monthly_metrics view (kartela, cross-month, etc.)
--   2. product_analytics view (salesperson_id support)
--   3. salesperson backfill on clients table
--   4. get_dashboard_stats RPC
-- ============================================================

-- ─── STEP 1: Backfill salesperson on clients from orders ─────────────────
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

-- ─── STEP 2: client_monthly_metrics (with kartela + cross-month) ─────────
DROP VIEW IF EXISTS public.client_monthly_metrics;

CREATE VIEW public.client_monthly_metrics AS
WITH
classified AS (
  SELECT
    o.client_id,
    o.month,
    o.year,
    o.quantity,
    o.salesperson_id,
    p.name AS product_name,
    (p.name ILIKE '%كارتل%' OR p.name ILIKE '%cartela%') AS is_kartela,
    TRIM(REGEXP_REPLACE(p.name,
      '\s*(كارتله|كارتلة|كارتيله|كارتيلة|cartela)\s*$',
      '', 'i')) AS base_product
  FROM public.orders o
  JOIN public.products p ON p.id = o.product_id
),

meter_summary AS (
  SELECT
    client_id,
    month,
    year,
    SUM(quantity)                AS total_meters,
    COUNT(DISTINCT product_name) AS unique_products,
    (array_agg(product_name ORDER BY quantity DESC))[1] AS top_product_name,
    (
      SELECT c2.salesperson_id
      FROM   classified c2
      WHERE  c2.client_id = c.client_id
        AND  c2.month     = c.month
        AND  c2.year      = c.year
        AND  c2.salesperson_id IS NOT NULL
      GROUP  BY c2.salesperson_id
      ORDER  BY SUM(c2.quantity) DESC
      LIMIT  1
    ) AS primary_salesperson_id
  FROM classified c
  WHERE NOT is_kartela
  GROUP BY client_id, month, year
),

top_meter AS (
  SELECT DISTINCT ON (client_id, month, year)
    client_id,
    month,
    year,
    product_name AS top_product_name
  FROM classified
  WHERE NOT is_kartela
  ORDER BY client_id, month, year, quantity DESC
),

latest_kartela AS (
  SELECT DISTINCT ON (client_id, base_product)
    client_id,
    base_product,
    month  AS kartela_month,
    year   AS kartela_year,
    SUM(quantity) OVER (PARTITION BY client_id, base_product, month, year) AS kartela_qty
  FROM classified
  WHERE is_kartela
  ORDER BY client_id, base_product, year DESC, month DESC
)

SELECT
  c.id                                                           AS client_id,
  c.name                                                         AS client_name,
  c.partner_id,
  c.current_status,
  COALESCE(c.salesperson_id, ms.primary_salesperson_id)          AS salesperson_id,
  COALESCE(csp.name,         psp.name)                           AS salesperson_name,
  COALESCE(csp.code,         psp.code)                           AS salesperson_code,
  ms.month,
  ms.year,
  COALESCE(ms.total_meters,    0)                                AS total_meters,
  COALESCE(ms.unique_products, 0)                                AS unique_products,
  tm.top_product_name,
  COALESCE(lk.kartela_qty, 0)                                    AS cartela_count,
  COALESCE(lk.kartela_qty, 0)                                    AS top_product_cartela,
  lk.kartela_month,
  lk.kartela_year,
  CASE
    WHEN lk.kartela_month IS NULL                          THEN FALSE
    WHEN lk.kartela_month = ms.month
     AND lk.kartela_year  = ms.year                        THEN FALSE
    ELSE TRUE
  END AS kartela_cross_month,
  CASE
    WHEN COALESCE(ms.total_meters, 0) = 0    THEN 'RED'
    WHEN COALESCE(ms.total_meters, 0) < 100  THEN 'ORANGE'
    ELSE                                          'GREEN'
  END AS level
FROM       public.clients       c
JOIN       meter_summary        ms   ON  c.id              = ms.client_id
JOIN       top_meter            tm   ON  c.id              = tm.client_id
                                     AND ms.month          = tm.month
                                     AND ms.year           = tm.year
LEFT JOIN  public.salespersons  csp  ON  c.salesperson_id  = csp.id
LEFT JOIN  public.salespersons  psp  ON  ms.primary_salesperson_id = psp.id
LEFT JOIN  latest_kartela       lk   ON  lk.client_id      = c.id
                                     AND lk.base_product   = tm.top_product_name;

-- ─── STEP 3: product_analytics (with salesperson_id) ─────────────────────
-- Query pattern:
--   No salesperson filter  → .is("salesperson_id", null)
--   With salesperson filter → .eq("salesperson_id", uuid)

DROP VIEW IF EXISTS public.product_analytics;

CREATE VIEW public.product_analytics AS

-- Overall totals (all salespersons combined) — NULL salesperson_id
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

-- Per-salesperson breakdown
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

-- ─── STEP 4: get_dashboard_stats RPC ─────────────────────────────────────
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
    SELECT
      client_id,
      SUM(total_meters) AS total_m
    FROM public.client_monthly_metrics
    WHERE (p_year  IS NULL OR year  = p_year)
      AND (p_month IS NULL OR month = p_month)
      AND (p_salesperson_id IS NULL OR salesperson_id = p_salesperson_id::uuid)
    GROUP BY client_id
  )
  SELECT
    COALESCE(SUM(total_m),    0)                           AS total_meters,
    COUNT(*)                                               AS unique_clients,
    COUNT(*) FILTER (WHERE total_m >= 100)                 AS green_clients,
    COUNT(*) FILTER (WHERE total_m > 0 AND total_m < 100)  AS orange_clients
  FROM client_totals;
$$;

-- ─── Verify ───────────────────────────────────────────────────────────────
SELECT 'client_monthly_metrics' AS view_name, COUNT(*) AS rows FROM public.client_monthly_metrics
UNION ALL
SELECT 'product_analytics (overall)',  COUNT(*) FROM public.product_analytics WHERE salesperson_id IS NULL
UNION ALL
SELECT 'product_analytics (per-sp)',   COUNT(*) FROM public.product_analytics WHERE salesperson_id IS NOT NULL;

SELECT * FROM public.get_dashboard_stats();
