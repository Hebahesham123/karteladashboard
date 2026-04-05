-- Run this in Supabase SQL Editor to see all key numbers at once
SELECT
  COUNT(*)                                                            AS total_orders,
  SUM(CASE WHEN p.name NOT ILIKE '%كارتل%' AND p.name NOT ILIKE '%cartela%'
           THEN o.quantity ELSE 0 END)                               AS total_meters,
  SUM(CASE WHEN p.name ILIKE '%كارتل%' OR p.name ILIKE '%cartela%'
           THEN o.quantity ELSE 0 END)                               AS total_kartela,
  COUNT(DISTINCT o.month || '-' || o.year)                          AS months_with_data,
  MIN(o.month) || '/' || MIN(o.year) || ' → ' ||
  MAX(o.month) || '/' || MAX(o.year)                                 AS date_range
FROM public.orders o
JOIN public.products p ON p.id = o.product_id;
