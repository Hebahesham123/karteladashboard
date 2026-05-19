-- ============================================================
-- FIX: rebuild client_monthly_metrics_mv directly from base tables
--
-- Why: the previous regenerate script created the MV as
--   `SELECT * FROM client_monthly_metrics` (a view), then
--   redefined the view to `SELECT * FROM client_monthly_metrics_mv`.
--   Subsequent REFRESH MATERIALIZED VIEW calls re-read the MV
--   from itself (via the view), so new rows in `orders` never
--   make it into the MV.  e.g. May 2026 sync inserts show up in
--   `orders` but not in `client_monthly_metrics`.
--
-- Fix: drop and recreate the MV with its full CTE expansion
-- inline, then redefine the public view as a thin wrapper.
-- ============================================================

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS public.client_monthly_metrics_mv CASCADE;
DROP VIEW IF EXISTS public.client_monthly_metrics CASCADE;

-- 1) Build the MV directly from base tables (no intermediate view).
CREATE MATERIALIZED VIEW public.client_monthly_metrics_mv AS
WITH
classified AS (
  SELECT
    o.client_id,
    o.month,
    o.year,
    o.quantity,
    COALESCE(o.invoice_total, 0) AS invoice_total,
    o.salesperson_id,
    p.name AS product_name,
    (
      p.name ILIKE '%kartela%'
      OR p.name ILIKE '%cartela%'
      OR p.name LIKE '%' || chr(1603) || chr(1575) || chr(1585) || chr(1578) || chr(1604) || '%'
    ) AS is_kartela
  FROM public.orders o
  JOIN public.products p ON p.id = o.product_id
),
all_activity AS (
  SELECT
    client_id,
    month,
    year,
    MAX(salesperson_id::text)::uuid AS primary_salesperson_id
  FROM classified
  GROUP BY client_id, month, year
),
meter_summary AS (
  SELECT
    client_id,
    month,
    year,
    SUM(quantity) AS total_meters,
    SUM(invoice_total) AS total_revenue,
    COUNT(*) AS order_count,
    (array_agg(product_name ORDER BY quantity DESC))[1] AS top_product_name
  FROM classified
  WHERE NOT is_kartela
  GROUP BY client_id, month, year
),
kartela_summary AS (
  SELECT
    client_id,
    month,
    year,
    SUM(quantity) AS kartela_qty,
    SUM(invoice_total) AS kartela_revenue
  FROM classified
  WHERE is_kartela
  GROUP BY client_id, month, year
),
best_order AS (
  SELECT DISTINCT ON (o.client_id, o.month, o.year)
    o.client_id,
    o.month,
    o.year,
    o.category AS order_import_category,
    o.pricelist AS order_import_pricelist,
    o.invoice_ref AS order_import_invoice,
    o.branch AS order_import_branch,
    o.invoice_date AS order_import_invoice_date,
    o.created_at AS order_import_created_at
  FROM public.orders o
  ORDER BY
    o.client_id,
    o.month,
    o.year,
    (CASE WHEN nullif(trim(COALESCE(o.branch, '')), '') IS NOT NULL THEN 1 ELSE 0 END) DESC,
    (CASE WHEN o.invoice_date IS NOT NULL THEN 1 ELSE 0 END) DESC,
    o.created_at DESC NULLS LAST
)
SELECT
  c.id AS client_id,
  c.name AS client_name,
  c.partner_id AS partner_id,
  c.current_status,
  c.customer_type,
  COALESCE(c.salesperson_id, aa.primary_salesperson_id) AS salesperson_id,
  sp.name AS salesperson_name,
  sp.code AS salesperson_code,
  aa.month,
  aa.year,
  COALESCE(ms.total_meters, 0) AS total_meters,
  COALESCE(ms.total_revenue, 0) AS total_revenue,
  COALESCE(ms.order_count, 0) AS order_count,
  ms.top_product_name,
  COALESCE(ks.kartela_qty, 0) AS cartela_count,
  COALESCE(ks.kartela_qty, 0) AS top_product_cartela,
  ks.month AS kartela_month,
  ks.year AS kartela_year,
  CASE
    WHEN ks.month IS NULL THEN FALSE
    WHEN ks.month = aa.month AND ks.year = aa.year THEN FALSE
    ELSE TRUE
  END AS kartela_cross_month,
  CASE
    WHEN COALESCE(ms.total_meters, 0) = 0 THEN 'RED'
    WHEN COALESCE(ms.total_meters, 0) < 100 THEN 'ORANGE'
    ELSE 'GREEN'
  END AS level,
  bo.order_import_category,
  bo.order_import_pricelist,
  bo.order_import_invoice,
  bo.order_import_branch,
  bo.order_import_invoice_date,
  bo.order_import_created_at,
  (COALESCE(bo.order_import_invoice_date::timestamptz, bo.order_import_created_at)) AS order_import_line_at
FROM public.clients c
JOIN all_activity aa ON c.id = aa.client_id
LEFT JOIN meter_summary ms ON ms.client_id = c.id AND ms.month = aa.month AND ms.year = aa.year
LEFT JOIN kartela_summary ks ON ks.client_id = c.id AND ks.month = aa.month AND ks.year = aa.year
LEFT JOIN best_order bo ON bo.client_id = c.id AND bo.month = aa.month AND bo.year = aa.year
LEFT JOIN public.salespersons sp ON COALESCE(c.salesperson_id, aa.primary_salesperson_id) = sp.id;

-- 2) Thin wrapper view (what the app reads).
CREATE OR REPLACE VIEW public.client_monthly_metrics AS
SELECT * FROM public.client_monthly_metrics_mv;

-- 3) Same indexes as before for fast filtering.
CREATE INDEX IF NOT EXISTS idx_cmmv_year_month
  ON public.client_monthly_metrics_mv (year, month);
CREATE INDEX IF NOT EXISTS idx_cmmv_salesperson_year_month
  ON public.client_monthly_metrics_mv (salesperson_id, year, month);
CREATE INDEX IF NOT EXISTS idx_cmmv_client_year_month
  ON public.client_monthly_metrics_mv (client_id, year, month);
CREATE INDEX IF NOT EXISTS idx_cmmv_order_import_branch
  ON public.client_monthly_metrics_mv (order_import_branch);

GRANT SELECT ON public.client_monthly_metrics    TO authenticated, anon, service_role;
GRANT SELECT ON public.client_monthly_metrics_mv TO authenticated, anon, service_role;

COMMIT;

-- Verification — should now return > 0 for May 2026.
-- SELECT COUNT(*) FROM public.client_monthly_metrics WHERE month = 5 AND year = 2026;

-- Spot-check the previously-missing client (heba hashem, consumer type).
-- SELECT client_id, partner_id, customer_type, total_meters, order_import_branch
-- FROM public.client_monthly_metrics
-- WHERE partner_id = '1034940';
