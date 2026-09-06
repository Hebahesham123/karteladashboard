-- ============================================================
-- FIX: make the analytics refresh finish inside the API timeout
--
-- Why: refresh_analytics_materialized_views() started failing with
--   57014 "canceling statement due to statement timeout" (~8s cap on the
--   API role). The sync calls it after every run but discards the result,
--   so it kept reporting success while the MV stayed frozen -- September
--   2026 rows sat in `orders` and never reached the dashboard.
--
-- Two changes:
--   1. Cheaper kartela test. The EXISTS + jsonb_array_elements expansion ran
--      per element across 156k rows with meter_breakdown; a plain text LIKE
--      is equivalent here and far cheaper. Verified against live data: the
--      only labels containing كارت are "COLOR: كارتلة" and
--      "COLOR: كارتلة, Design: B1", both matched by this test.
--   2. Give the refresh function its own statement_timeout so a growing
--      dataset can never silently re-break it.
--
-- Supersedes FIX-kartela-from-odoo-attribute.sql (kartela logic unchanged
-- in meaning -- only how it is evaluated).
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
      -- Excel-era rows: the word was appended to the product name
      -- ("ARMANI كارتله"), so the name test still classifies them.
      p.name ILIKE '%kartela%'
      OR p.name ILIKE '%cartela%'
      OR p.name LIKE '%' || chr(1603) || chr(1575) || chr(1585) || chr(1578) || chr(1604) || '%'
      -- Odoo-era rows: the product is the plain fabric ("SPIDER") and the
      -- kartela marker arrives as an invoice-line attribute, which the sync
      -- stores in orders.meter_breakdown as [{"label":"COLOR: كارتلة",...}].
      -- Scanned as text rather than expanded per element: jsonb_array_elements
      -- over 156k rows pushed the rebuild past the API statement timeout.
      -- meter_breakdown only ever holds {"label","meters"}, and "meters" is a
      -- number, so a كارتل match in the text can only come from a label.
      OR COALESCE(o.meter_breakdown::text, '') LIKE '%' || chr(1603) || chr(1575) || chr(1585) || chr(1578) || chr(1604) || '%'
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

-- 4) The refresh runs from the API (PostgREST), which caps statements at ~8s.
--    A SET on the function raises the cap for the duration of the call, so a
--    full rebuild is no longer cancelled midway.
ALTER FUNCTION public.refresh_analytics_materialized_views()
  SET statement_timeout = '600s';

COMMIT;

-- Run this once now to load September, then let the nightly sync keep it current:
--   SELECT public.refresh_analytics_materialized_views();
--
-- Verification — September should stop being empty:
-- SELECT year, month, COUNT(*) AS clients, SUM(cartela_count) AS kartela
-- FROM public.client_monthly_metrics
-- WHERE year = 2026 AND month IN (7, 8, 9)
-- GROUP BY year, month ORDER BY year, month;
