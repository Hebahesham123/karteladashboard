-- ============================================================
-- DIAGNOSE — run this in Supabase SQL Editor
-- It will show exactly what's in the DB vs what should be
-- ============================================================

-- 1. How many orders are actually in the DB?
SELECT COUNT(*) AS total_orders FROM public.orders;

-- 2. Total meters in the DB (excluding kartela)
SELECT
  SUM(o.quantity) AS total_meters_no_kartela,
  SUM(CASE WHEN p.name ILIKE '%كارتل%' OR p.name ILIKE '%cartela%'
           THEN o.quantity ELSE 0 END) AS total_kartela_qty,
  SUM(o.quantity) AS total_all_quantities
FROM public.orders o
JOIN public.products p ON p.id = o.product_id;

-- 3. Orders per month (to see what months have data)
SELECT month, year, COUNT(*) AS orders, SUM(o.quantity) AS total_qty
FROM public.orders o
GROUP BY month, year
ORDER BY year, month;

-- 4. Check if get_dashboard_stats function exists
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'get_dashboard_stats';
