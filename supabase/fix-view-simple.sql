-- ============================================================
-- SIMPLE reliable view — run this in Supabase SQL Editor
-- ============================================================

DROP VIEW IF EXISTS public.client_monthly_metrics;

CREATE VIEW public.client_monthly_metrics AS
SELECT
  c.id                         AS client_id,
  c.name                       AS client_name,
  c.partner_id,
  c.current_status,

  -- Salesperson: client's own, or fallback from orders
  COALESCE(c.salesperson_id,
    (SELECT o2.salesperson_id
     FROM public.orders o2
     WHERE o2.client_id = c.id
       AND o2.month = o.month
       AND o2.year  = o.year
       AND o2.salesperson_id IS NOT NULL
     GROUP BY o2.salesperson_id
     ORDER BY SUM(o2.quantity) DESC
     LIMIT 1)
  ) AS salesperson_id,

  COALESCE(csp.name,
    (SELECT sp2.name FROM public.orders o3
     JOIN public.salespersons sp2 ON sp2.id = o3.salesperson_id
     WHERE o3.client_id = c.id AND o3.month = o.month AND o3.year = o.year
       AND o3.salesperson_id IS NOT NULL
     GROUP BY sp2.name, sp2.id ORDER BY SUM(o3.quantity) DESC LIMIT 1)
  ) AS salesperson_name,

  COALESCE(csp.code,
    (SELECT sp3.code FROM public.orders o4
     JOIN public.salespersons sp3 ON sp3.id = o4.salesperson_id
     WHERE o4.client_id = c.id AND o4.month = o.month AND o4.year = o.year
       AND o4.salesperson_id IS NOT NULL
     GROUP BY sp3.code, sp3.id ORDER BY SUM(o4.quantity) DESC LIMIT 1)
  ) AS salesperson_code,

  o.month,
  o.year,

  -- Meters only (exclude كارتله products)
  SUM(CASE WHEN p.name NOT ILIKE '%كارتل%' AND p.name NOT ILIKE '%cartela%'
           THEN o.quantity ELSE 0 END)   AS total_meters,

  -- Total كارتله count this month
  SUM(CASE WHEN p.name ILIKE '%كارتل%' OR p.name ILIKE '%cartela%'
           THEN o.quantity ELSE 0 END)   AS cartela_count,

  SUM(CASE WHEN p.name ILIKE '%كارتل%' OR p.name ILIKE '%cartela%'
           THEN o.quantity ELSE 0 END)   AS top_product_cartela,

  COUNT(DISTINCT CASE WHEN p.name NOT ILIKE '%كارتل%' AND p.name NOT ILIKE '%cartela%'
                      THEN p.id END)     AS unique_products,

  -- Top product name (most meters, non-kartela)
  (SELECT p2.name
   FROM   public.orders o5
   JOIN   public.products p2 ON p2.id = o5.product_id
   WHERE  o5.client_id = c.id
     AND  o5.month     = o.month
     AND  o5.year      = o.year
     AND  p2.name NOT ILIKE '%كارتل%'
     AND  p2.name NOT ILIKE '%cartela%'
   GROUP  BY p2.name
   ORDER  BY SUM(o5.quantity) DESC
   LIMIT  1)                             AS top_product_name,

  -- Kartela date = same month as meters (cross-month handled in app layer)
  o.month  AS kartela_month,
  o.year   AS kartela_year,
  FALSE    AS kartela_cross_month,

  CASE
    WHEN SUM(CASE WHEN p.name NOT ILIKE '%كارتل%' AND p.name NOT ILIKE '%cartela%'
                  THEN o.quantity ELSE 0 END) = 0    THEN 'RED'
    WHEN SUM(CASE WHEN p.name NOT ILIKE '%كارتل%' AND p.name NOT ILIKE '%cartela%'
                  THEN o.quantity ELSE 0 END) < 100   THEN 'ORANGE'
    ELSE 'GREEN'
  END AS level

FROM  public.clients   c
JOIN  public.orders    o  ON  c.id  = o.client_id
JOIN  public.products  p  ON  p.id  = o.product_id
LEFT JOIN public.salespersons csp ON csp.id = c.salesperson_id

GROUP BY
  c.id, c.name, c.partner_id, c.current_status, c.salesperson_id,
  csp.name, csp.code,
  o.month, o.year;

-- Quick verify
SELECT client_name, month, year, total_meters, cartela_count, top_product_name, level
FROM   public.client_monthly_metrics
LIMIT  10;
