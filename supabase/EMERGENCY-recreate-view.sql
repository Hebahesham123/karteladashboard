-- ============================================================
-- EMERGENCY: Recreate ALL views + dashboard function
-- NO Arabic text — safe to paste in any Supabase SQL editor.
-- Run this ONCE. It fixes all 3 views + the dashboard RPC.
-- ============================================================

-- Kartela product detection: products whose name contains
-- "kartela" / "cartela" (Latin) OR Arabic form using chr() codes:
-- chr(1603)=ك  chr(1575)=ا  chr(1585)=ر  chr(1578)=ت  chr(1604)=ل
-- So the Arabic "كارتل" = chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604)

-- ── 1. client_monthly_metrics ─────────────────────────────────────────────
DROP VIEW IF EXISTS public.client_monthly_metrics;

CREATE VIEW public.client_monthly_metrics AS
WITH
classified AS (
  SELECT
    o.client_id, o.month, o.year, o.quantity, o.salesperson_id,
    p.name AS product_name,
    (
      p.name ILIKE '%kartela%' OR p.name ILIKE '%cartela%'
      OR p.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604) || '%'
    ) AS is_kartela
  FROM public.orders o
  JOIN public.products p ON p.id = o.product_id
),
-- Every (client, month, year) with ANY order — drives the final result
-- Includes kartela-only clients so they appear as RED with 0 meters
all_activity AS (
  SELECT
    client_id, month, year,
    MAX(salesperson_id::text)::uuid AS primary_salesperson_id
  FROM classified
  GROUP BY client_id, month, year
),
-- Non-kartela meters only
meter_summary AS (
  SELECT
    client_id, month, year,
    SUM(quantity)                                         AS total_meters,
    (array_agg(product_name ORDER BY quantity DESC))[1]  AS top_product_name
  FROM classified
  WHERE NOT is_kartela
  GROUP BY client_id, month, year
),
-- Kartela quantities
kartela_summary AS (
  SELECT client_id, month, year, SUM(quantity) AS kartela_qty
  FROM classified
  WHERE is_kartela
  GROUP BY client_id, month, year
)
SELECT
  c.id                                                                      AS client_id,
  c.name                                                                    AS client_name,
  c.partner_id,
  c.current_status,
  COALESCE(c.salesperson_id, aa.primary_salesperson_id)                    AS salesperson_id,
  sp.name                                                                   AS salesperson_name,
  sp.code                                                                   AS salesperson_code,
  aa.month,
  aa.year,
  COALESCE(ms.total_meters, 0)                                             AS total_meters,
  ms.top_product_name,
  COALESCE(ks.kartela_qty, 0)                                             AS cartela_count,
  COALESCE(ks.kartela_qty, 0)                                             AS top_product_cartela,
  ks.month                                                                  AS kartela_month,
  ks.year                                                                   AS kartela_year,
  CASE
    WHEN ks.month IS NULL                              THEN FALSE
    WHEN ks.month = aa.month AND ks.year = aa.year    THEN FALSE
    ELSE TRUE
  END                                                                       AS kartela_cross_month,
  CASE
    WHEN COALESCE(ms.total_meters, 0) = 0   THEN 'RED'
    WHEN COALESCE(ms.total_meters, 0) < 100 THEN 'ORANGE'
    ELSE                                         'GREEN'
  END                                                                       AS level
FROM       public.clients      c
JOIN       all_activity        aa  ON c.id = aa.client_id
LEFT JOIN  meter_summary       ms  ON ms.client_id = c.id AND ms.month = aa.month AND ms.year = aa.year
LEFT JOIN  kartela_summary     ks  ON ks.client_id = c.id AND ks.month = aa.month AND ks.year = aa.year
LEFT JOIN  public.salespersons sp  ON COALESCE(c.salesperson_id, aa.primary_salesperson_id) = sp.id;

-- ── 2. salesperson_performance (excludes kartela from meters) ─────────────
DROP VIEW IF EXISTS public.salesperson_performance;

CREATE VIEW public.salesperson_performance AS
SELECT
  sp.id                                AS salesperson_id,
  sp.name                              AS salesperson_name,
  sp.code                              AS salesperson_code,
  o.month,
  o.year,
  COUNT(DISTINCT o.client_id)          AS active_clients,
  COALESCE(SUM(CASE
    WHEN (
      p.name ILIKE '%kartela%'
      OR p.name ILIKE '%cartela%'
      OR p.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604) || '%'
    ) THEN 0
    ELSE o.quantity
  END), 0)                             AS total_meters,
  COUNT(DISTINCT CASE
    WHEN (
      p.name ILIKE '%kartela%'
      OR p.name ILIKE '%cartela%'
      OR p.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604) || '%'
    ) THEN NULL
    ELSE o.product_id
  END)                                 AS unique_products
FROM public.salespersons sp
LEFT JOIN public.orders   o ON sp.id = o.salesperson_id
LEFT JOIN public.products p ON p.id  = o.product_id
GROUP BY sp.id, sp.name, sp.code, o.month, o.year;

-- ── 3. product_analytics (excludes kartela products) ─────────────────────
DROP VIEW IF EXISTS public.product_analytics;

CREATE VIEW public.product_analytics AS
SELECT
  p.id                         AS product_id,
  p.name                       AS product_name,
  o.month,
  o.year,
  NULL::UUID                   AS salesperson_id,
  COUNT(DISTINCT o.client_id)  AS unique_clients,
  COALESCE(SUM(o.quantity), 0) AS total_meters,
  COALESCE(AVG(o.quantity), 0) AS avg_meters_per_order,
  COUNT(*)                     AS order_count
FROM public.products p
LEFT JOIN public.orders o ON p.id = o.product_id
WHERE NOT (
  p.name ILIKE '%kartela%'
  OR p.name ILIKE '%cartela%'
  OR p.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604) || '%'
)
GROUP BY p.id, p.name, o.month, o.year
UNION ALL
SELECT
  p.id,
  p.name,
  o.month,
  o.year,
  o.salesperson_id,
  COUNT(DISTINCT o.client_id),
  COALESCE(SUM(o.quantity), 0),
  COALESCE(AVG(o.quantity), 0),
  COUNT(*)
FROM public.products p
JOIN  public.orders o ON p.id = o.product_id
WHERE o.salesperson_id IS NOT NULL
  AND NOT (
    p.name ILIKE '%kartela%'
    OR p.name ILIKE '%cartela%'
    OR p.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604) || '%'
  )
GROUP BY p.id, p.name, o.month, o.year, o.salesperson_id;

-- ── 4. get_dashboard_stats RPC ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(
  p_year           INT  DEFAULT NULL,
  p_month          INT  DEFAULT NULL,
  p_salesperson_id UUID DEFAULT NULL
)
RETURNS TABLE (
  total_meters   NUMERIC,
  unique_clients BIGINT,
  green_clients  BIGINT,
  orange_clients BIGINT
)
LANGUAGE sql SECURITY DEFINER AS $$
  WITH client_totals AS (
    SELECT client_id, SUM(total_meters) AS total_m
    FROM   public.client_monthly_metrics
    WHERE  (p_year  IS NULL OR year  = p_year)
      AND  (p_month IS NULL OR month = p_month)
      AND  (p_salesperson_id IS NULL OR salesperson_id = p_salesperson_id)
    GROUP  BY client_id
  )
  SELECT
    COALESCE(SUM(total_m), 0)                            AS total_meters,
    COUNT(*)                                              AS unique_clients,
    COUNT(*) FILTER (WHERE total_m >= 100)               AS green_clients,
    COUNT(*) FILTER (WHERE total_m > 0 AND total_m < 100) AS orange_clients
  FROM client_totals;
$$;

-- ── 5. Backfill salesperson on clients ───────────────────────────────────
UPDATE public.clients c
SET salesperson_id = (
  SELECT o.salesperson_id FROM public.orders o
  WHERE  o.client_id = c.id AND o.salesperson_id IS NOT NULL
  ORDER  BY o.year DESC, o.month DESC LIMIT 1
)
WHERE c.salesperson_id IS NULL;

-- ── 6. Grant access ───────────────────────────────────────────────────────
GRANT SELECT ON public.client_monthly_metrics  TO authenticated, anon;
GRANT SELECT ON public.salesperson_performance TO authenticated, anon;
GRANT SELECT ON public.product_analytics       TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats TO authenticated, anon;

-- ── 7. Performance indexes (critical — prevents view timeout) ──────────────
CREATE INDEX IF NOT EXISTS idx_orders_month_year
  ON public.orders(month, year);
CREATE INDEX IF NOT EXISTS idx_orders_client_id
  ON public.orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_product_id
  ON public.orders(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_client_month_year
  ON public.orders(client_id, month, year);
CREATE INDEX IF NOT EXISTS idx_orders_salesperson_id
  ON public.orders(salesperson_id);
CREATE INDEX IF NOT EXISTS idx_products_name_lower
  ON public.products(lower(name));

-- ── 8. Unique constraint to prevent duplicate uploads ──────────────────────
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_client_product_month_year_unique;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_client_product_month_year_unique
  UNIQUE (client_id, product_id, month, year);

-- ── 9. Verify ─────────────────────────────────────────────────────────────
SELECT 'client_monthly_metrics'   AS view_name, COUNT(*) AS rows FROM public.client_monthly_metrics
UNION ALL
SELECT 'salesperson_performance', COUNT(*) FROM public.salesperson_performance WHERE total_meters > 0
UNION ALL
SELECT 'product_analytics',       COUNT(*) FROM public.product_analytics WHERE salesperson_id IS NULL;

SELECT client_name, salesperson_name, month, year,
       total_meters, cartela_count, kartela_cross_month, level
FROM   public.client_monthly_metrics
ORDER  BY total_meters DESC
LIMIT  10;
