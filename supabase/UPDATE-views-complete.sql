-- ============================================================
-- COMPLETE VIEW UPDATE — Run this in Supabase SQL Editor
-- Adds order_count to salesperson_performance view
-- Ensures all views work correctly with the updated dashboard
-- ============================================================

-- ── 1. Update salesperson_performance to include order_count ─────────────
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
  END)                                 AS unique_products,
  COUNT(o.id)                          AS order_count
FROM public.salespersons sp
LEFT JOIN public.orders   o ON sp.id = o.salesperson_id
LEFT JOIN public.products p ON p.id  = o.product_id
GROUP BY sp.id, sp.name, sp.code, o.month, o.year;

-- ── 2. Re-grant access ────────────────────────────────────────────────────
GRANT SELECT ON public.salesperson_performance TO authenticated, anon;

-- ── 3. Verify views are healthy ───────────────────────────────────────────
SELECT 'salesperson_performance' AS view_name, COUNT(*) AS rows
FROM public.salesperson_performance
WHERE total_meters > 0

UNION ALL

SELECT 'client_monthly_metrics', COUNT(*)
FROM public.client_monthly_metrics

UNION ALL

SELECT 'product_analytics', COUNT(*)
FROM public.product_analytics WHERE salesperson_id IS NULL;

-- ── 4. Check order count per month (verify data) ──────────────────────────
SELECT month, year, COUNT(*) AS total_orders, SUM(quantity) AS total_meters_raw
FROM public.orders
GROUP BY month, year
ORDER BY year DESC, month DESC
LIMIT 24;
