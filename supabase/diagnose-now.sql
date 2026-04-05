-- ============================================================
-- DIAGNOSE: Run this to see what is in your database
-- Paste in Supabase SQL Editor and run
-- ============================================================

-- 1. Does the view exist?
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('client_monthly_metrics', 'product_analytics', 'salesperson_performance')
ORDER BY table_name;

-- 2. How many rows in each base table?
SELECT 'clients'      AS tbl, COUNT(*) AS rows FROM public.clients
UNION ALL
SELECT 'orders',       COUNT(*) FROM public.orders
UNION ALL
SELECT 'products',     COUNT(*) FROM public.products
UNION ALL
SELECT 'salespersons', COUNT(*) FROM public.salespersons;

-- 3. Sample orders (first 5)
SELECT o.id, o.month, o.year, o.quantity, p.name AS product, c.name AS client
FROM public.orders o
JOIN public.products p ON p.id = o.product_id
JOIN public.clients  c ON c.id = o.client_id
LIMIT 5;
