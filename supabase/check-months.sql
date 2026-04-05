-- See exactly which months/years have data and how much
SELECT
  year,
  month,
  COUNT(*) AS orders,
  ROUND(SUM(CASE WHEN p.name NOT ILIKE '%كارتل%' THEN o.quantity ELSE 0 END)) AS meters
FROM public.orders o
JOIN public.products p ON p.id = o.product_id
GROUP BY year, month
ORDER BY year, month;
