-- ============================================================
-- Fix product_analytics view — adds salesperson_id support
--
-- Query pattern:
--   No salesperson filter  → .is("salesperson_id", null)
--   With salesperson filter → .eq("salesperson_id", uuid)
--
-- Run in: Supabase → SQL Editor → Paste → Run
-- ============================================================

DROP VIEW IF EXISTS public.product_analytics;

CREATE VIEW public.product_analytics AS

-- Overall totals (all salespersons combined)
SELECT
  p.id                                      AS product_id,
  p.name                                    AS product_name,
  o.month,
  o.year,
  NULL::UUID                                AS salesperson_id,
  COUNT(DISTINCT o.client_id)               AS unique_clients,
  COALESCE(SUM(o.quantity), 0)              AS total_meters,
  COALESCE(AVG(o.quantity), 0)              AS avg_meters_per_order,
  COUNT(*)                                  AS order_count
FROM public.products p
LEFT JOIN public.orders o ON p.id = o.product_id
GROUP BY p.id, p.name, o.month, o.year

UNION ALL

-- Per-salesperson breakdown
SELECT
  p.id                                      AS product_id,
  p.name                                    AS product_name,
  o.month,
  o.year,
  o.salesperson_id,
  COUNT(DISTINCT o.client_id)               AS unique_clients,
  COALESCE(SUM(o.quantity), 0)              AS total_meters,
  COALESCE(AVG(o.quantity), 0)              AS avg_meters_per_order,
  COUNT(*)                                  AS order_count
FROM public.products p
JOIN  public.orders o ON p.id = o.product_id
WHERE o.salesperson_id IS NOT NULL
GROUP BY p.id, p.name, o.month, o.year, o.salesperson_id;

-- Verify
SELECT product_name, salesperson_id, month, year, total_meters, unique_clients
FROM public.product_analytics
ORDER BY total_meters DESC
LIMIT 15;
