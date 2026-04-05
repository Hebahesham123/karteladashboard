-- ============================================================
-- Update client_monthly_metrics view
-- Separates regular meters from كارتله counts
-- Run this in Supabase → SQL Editor
-- ============================================================

DROP VIEW IF EXISTS public.client_monthly_metrics;

CREATE VIEW public.client_monthly_metrics AS
WITH order_summary AS (
  SELECT
    o.client_id,
    o.month,
    o.year,

    -- Regular meters: all products NOT ending with ' كارتله'
    COALESCE(SUM(CASE WHEN p.name NOT LIKE '% كارتله' THEN o.quantity ELSE 0 END), 0) AS total_meters,

    -- Cartela count: products ending with ' كارتله'
    COALESCE(SUM(CASE WHEN p.name LIKE '% كارتله' THEN o.quantity ELSE 0 END), 0) AS cartela_count,

    COUNT(DISTINCT CASE WHEN p.name NOT LIKE '% كارتله' THEN o.product_id END) AS unique_products,

    -- Primary salesperson (by most meters)
    (
      SELECT o2.salesperson_id FROM public.orders o2
      WHERE o2.client_id = o.client_id AND o2.month = o.month AND o2.year = o.year
        AND o2.salesperson_id IS NOT NULL
      GROUP BY o2.salesperson_id ORDER BY SUM(o2.quantity) DESC LIMIT 1
    ) AS primary_salesperson_id,

    -- Top regular product (excluding كارتله variants)
    (
      SELECT p2.name
      FROM public.orders o3
      JOIN public.products p2 ON p2.id = o3.product_id
      WHERE o3.client_id = o.client_id AND o3.month = o.month AND o3.year = o.year
        AND p2.name NOT LIKE '% كارتله'
      GROUP BY p2.name
      ORDER BY SUM(o3.quantity) DESC
      LIMIT 1
    ) AS top_product_name,

    -- Cartela count for the top product
    (
      SELECT COALESCE(SUM(o5.quantity), 0)
      FROM public.orders o5
      JOIN public.products p5 ON p5.id = o5.product_id
      WHERE o5.client_id = o.client_id AND o5.month = o.month AND o5.year = o.year
        AND p5.name = (
          SELECT p2.name || ' كارتله'
          FROM public.orders o3
          JOIN public.products p2 ON p2.id = o3.product_id
          WHERE o3.client_id = o.client_id AND o3.month = o.month AND o3.year = o.year
            AND p2.name NOT LIKE '% كارتله'
          GROUP BY p2.name
          ORDER BY SUM(o3.quantity) DESC
          LIMIT 1
        )
    ) AS top_product_cartela

  FROM public.orders o
  JOIN public.products p ON p.id = o.product_id
  GROUP BY o.client_id, o.month, o.year
)
SELECT
  c.id            AS client_id,
  c.name          AS client_name,
  c.partner_id,
  c.current_status,
  COALESCE(c.salesperson_id, os.primary_salesperson_id) AS salesperson_id,
  COALESCE(csp.name, psp.name)  AS salesperson_name,
  COALESCE(csp.code, psp.code)  AS salesperson_code,
  os.month,
  os.year,
  os.total_meters,
  os.cartela_count,
  os.unique_products,
  os.top_product_name,
  COALESCE(os.top_product_cartela, 0) AS top_product_cartela,
  CASE
    WHEN os.total_meters = 0   THEN 'RED'
    WHEN os.total_meters < 100 THEN 'ORANGE'
    ELSE                            'GREEN'
  END AS level
FROM public.clients c
JOIN order_summary os ON c.id = os.client_id
LEFT JOIN public.salespersons csp ON c.salesperson_id        = csp.id
LEFT JOIN public.salespersons psp ON os.primary_salesperson_id = psp.id;
