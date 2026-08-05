-- ============================================================
-- FIX: Kartela is invisible for months imported from Odoo
-- Run in Supabase SQL Editor (one transaction).
-- ============================================================
-- PROBLEM
--   The two import paths store kartela differently:
--
--   • Excel upload  → a separate product row, e.g. "ROCK كارتله".
--   • Odoo sync     → the SAME base product ("ROCK"), with the kartela marker
--                     only in orders.meter_breakdown, e.g.
--                     [{"label":"COLOR: كارتلة","meters":1}]
--
--   client_monthly_metrics classified kartela by PRODUCT NAME only, so every
--   Odoo-synced kartela line was invisible:
--
--     2026-07 (Odoo)  →  cartela_count = 0   (real: 1,644 units, 272 clients)
--     2026-08 (Odoo)  →  cartela_count = 0
--
--   Worse, those kartela units were counted as ordinary METERS, which inflated
--   total_meters and pushed cartela-only clients out of the RED level
--   (2026-07 had RED = 0 clients, which is impossible).
--
-- WHAT THIS SCRIPT CHANGES
--   Kartela is now detected from EITHER source, per order line:
--     kartela_qty = whole quantity            when the product name is kartela
--                 = kartela meters in the     otherwise
--                   meter_breakdown labels
--     total_meters excludes that kartela portion
--     revenue is split proportionally between meters and kartela
--
--   The two sources never overlap on the same row (verified on 2026-05..07),
--   so nothing is double counted.
--
-- EXPECTED RESULT (simulated against live data before writing this script).
--   Verification query at the bottom = all clients, every customer type:
--     2026-07  kartela units 0 → 1,644   buyers 0 → 272   RED 0 → 42
--              total_meters 598,205 → 596,561  (−1,644, the kartela units)
--     2026-08  kartela units 0 → 88      buyers 0 → 15    RED 0 → 7
--
--   Dashboard figures (VIP / تجاري / جملة only) will read:
--     2026-05  1,727 kartela / 343 buyers   → UNCHANGED (Excel month, no regression)
--     2026-06  1,413 → 2,680 kartela        buyers 203 → 387    RED 31 → 82
--     2026-07      0 → 1,594 kartela        buyers   0 → 260    RED  0 → 34
--     2026-08      0 →    86 kartela        buyers   0 →  14    RED  0 →  6
--   Meters move less than 0.4% — only the kartela units leave the meter total.
--
-- AFTER RUNNING
--   Hard-refresh the dashboard (Ctrl+Shift+R). No re-upload or re-sync needed —
--   this only re-reads existing rows in `orders`.
-- ============================================================

BEGIN;

-- ── 1) Shared kartela matcher (product names AND meter_breakdown labels) ────
-- Arabic literals are built with chr() so the script survives any editor encoding.
--   كارتل   1603,1575,1585,1578,1604          → covers كارتله / كارتلة
--   كارتيلا 1603,1575,1585,1578,1610,1604,1575
--   كرتيلا  1603,1585,1578,1610,1604,1575
CREATE OR REPLACE FUNCTION public.is_kartela_text(p text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p IS NOT NULL AND (
       p ILIKE '%kartela%'
    OR p ILIKE '%cartela%'
    OR p LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604) || '%'
    OR p LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1610)||chr(1604)||chr(1575) || '%'
    OR p LIKE '%' || chr(1603)||chr(1585)||chr(1578)||chr(1610)||chr(1604)||chr(1575) || '%'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_kartela_text(text) TO authenticated, anon;

-- ── 2) Rebuild the view + materialized snapshot ────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS public.client_monthly_metrics_mv CASCADE;
DROP VIEW IF EXISTS public.client_monthly_metrics CASCADE;

CREATE VIEW public.client_monthly_metrics AS
WITH
classified AS (
  SELECT
    o.client_id,
    o.month,
    o.year,
    COALESCE(o.quantity, 0) AS quantity,
    COALESCE(o.invoice_total, 0) AS invoice_total,
    o.salesperson_id,
    p.name AS product_name,
    public.is_kartela_text(p.name) AS is_kartela_product,
    -- Odoo path: kartela hidden inside the per-colour breakdown of a normal product
    COALESCE((
      SELECT SUM(GREATEST(COALESCE((e.value ->> 'meters')::numeric, 0), 0))
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(o.meter_breakdown) = 'array'
                  THEN o.meter_breakdown
                  ELSE '[]'::jsonb END
           ) AS e(value)
      WHERE public.is_kartela_text(COALESCE(e.value ->> 'label', e.value ->> 'name'))
    ), 0) AS kartela_breakdown_qty
  FROM public.orders o
  JOIN public.products p ON p.id = o.product_id
),
split AS (
  SELECT
    c.*,
    CASE WHEN c.is_kartela_product THEN c.quantity
         ELSE LEAST(c.kartela_breakdown_qty, c.quantity) END AS kartela_qty,
    CASE WHEN c.is_kartela_product THEN 0
         ELSE GREATEST(c.quantity - c.kartela_breakdown_qty, 0) END AS meter_qty
  FROM classified c
),
priced AS (
  SELECT
    s.*,
    CASE
      WHEN s.quantity > 0 THEN s.invoice_total * (s.kartela_qty / s.quantity)
      WHEN s.is_kartela_product THEN s.invoice_total
      ELSE 0
    END AS kartela_revenue_part
  FROM split s
),
all_activity AS (
  SELECT
    client_id,
    month,
    year,
    MAX(salesperson_id::text)::uuid AS primary_salesperson_id
  FROM priced
  GROUP BY client_id, month, year
),
meter_summary AS (
  SELECT
    client_id,
    month,
    year,
    SUM(meter_qty) AS total_meters,
    SUM(invoice_total - kartela_revenue_part) AS total_revenue,
    COUNT(*) AS order_count,
    (array_agg(product_name ORDER BY meter_qty DESC))[1] AS top_product_name
  FROM priced
  -- Drop kartela product rows and lines that are 100% kartela; a partly-kartela
  -- line still counts as an order, exactly as before this fix.
  WHERE NOT is_kartela_product
    AND NOT (quantity > 0 AND kartela_qty >= quantity)
  GROUP BY client_id, month, year
),
kartela_summary AS (
  SELECT
    client_id,
    month,
    year,
    SUM(kartela_qty) AS kartela_qty,
    SUM(kartela_revenue_part) AS kartela_revenue
  FROM priced
  WHERE kartela_qty > 0
  GROUP BY client_id, month, year
),
-- One representative order line per client × month × year (same logic as app orderImportMeta)
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

-- Materialized snapshot (fast reads; matches OPTIMIZE-materialized-analytics.sql)
CREATE MATERIALIZED VIEW public.client_monthly_metrics_mv AS
SELECT * FROM public.client_monthly_metrics;

-- App keeps using this name; it reads from the MV
CREATE OR REPLACE VIEW public.client_monthly_metrics AS
SELECT * FROM public.client_monthly_metrics_mv;

CREATE INDEX IF NOT EXISTS idx_cmmv_year_month ON public.client_monthly_metrics_mv (year, month);
CREATE INDEX IF NOT EXISTS idx_cmmv_salesperson_year_month ON public.client_monthly_metrics_mv (salesperson_id, year, month);
CREATE INDEX IF NOT EXISTS idx_cmmv_client_year_month ON public.client_monthly_metrics_mv (client_id, year, month);

GRANT SELECT ON public.client_monthly_metrics TO authenticated, anon;
GRANT SELECT ON public.client_monthly_metrics_mv TO authenticated, anon;

COMMIT;

-- ── 3) Verify: kartela should now be non-zero for the Odoo months ──────────
SELECT
  year,
  month,
  COUNT(*)                                   AS clients_with_activity,
  COUNT(*) FILTER (WHERE cartela_count > 0)  AS clients_who_bought_kartela,
  ROUND(SUM(cartela_count))                  AS kartela_units,
  ROUND(SUM(total_meters))                   AS total_meters,
  COUNT(*) FILTER (WHERE level = 'RED')      AS cartela_only_clients
FROM public.client_monthly_metrics
WHERE year = 2026 AND month BETWEEN 5 AND 8
GROUP BY year, month
ORDER BY year, month;
