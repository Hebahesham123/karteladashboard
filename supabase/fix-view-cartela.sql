-- ============================================================
-- Rebuild client_monthly_metrics with separate كارتله counts
-- Run in: Supabase → SQL Editor → Paste → Run
-- ============================================================

DROP VIEW IF EXISTS public.client_monthly_metrics;

CREATE VIEW public.client_monthly_metrics AS
WITH order_summary AS (
  SELECT
    o.client_id,
    o.month,
    o.year,

    -- Meters: only NON-كارتله products
    SUM(CASE WHEN p.name NOT ILIKE '%كارتل%' AND p.name NOT ILIKE '%cartela%'
             THEN o.quantity ELSE 0 END)  AS total_meters,

    -- Cartelah count: only كارتله products
    SUM(CASE WHEN p.name ILIKE '%كارتل%' OR p.name ILIKE '%cartela%'
             THEN o.quantity ELSE 0 END)  AS cartela_count,

    COUNT(DISTINCT CASE WHEN p.name NOT ILIKE '%كارتل%' AND p.name NOT ILIKE '%cartela%'
                        THEN o.product_id END) AS unique_products,

    -- Primary salesperson (most meters this month)
    (
      SELECT o2.salesperson_id
      FROM   public.orders o2
      WHERE  o2.client_id      = o.client_id
        AND  o2.month          = o.month
        AND  o2.year           = o.year
        AND  o2.salesperson_id IS NOT NULL
      GROUP  BY o2.salesperson_id
      ORDER  BY SUM(o2.quantity) DESC
      LIMIT  1
    ) AS primary_salesperson_id,

    -- Top regular product (highest meters, excluding كارتله)
    (
      SELECT p2.name
      FROM   public.orders o3
      JOIN   public.products p2 ON p2.id = o3.product_id
      WHERE  o3.client_id        = o.client_id
        AND  o3.month            = o.month
        AND  o3.year             = o.year
        AND  p2.name NOT ILIKE '%كارتل%'
        AND  p2.name NOT ILIKE '%cartela%'
      GROUP  BY p2.name
      ORDER  BY SUM(o3.quantity) DESC
      LIMIT  1
    ) AS top_product_name,

    -- Cartelah qty for the top regular product specifically
    (
      SELECT SUM(o4.quantity)
      FROM   public.orders o4
      JOIN   public.products p3 ON p3.id = o4.product_id
      WHERE  o4.client_id = o.client_id
        AND  o4.month     = o.month
        AND  o4.year      = o.year
        AND  (p3.name ILIKE '%كارتل%' OR p3.name ILIKE '%cartela%')
        AND  p3.name ILIKE (
               '%' || (
                 SELECT p4.name
                 FROM   public.orders o5
                 JOIN   public.products p4 ON p4.id = o5.product_id
                 WHERE  o5.client_id        = o.client_id
                   AND  o5.month            = o.month
                   AND  o5.year             = o.year
                   AND  p4.name NOT ILIKE '%كارتل%'
                   AND  p4.name NOT ILIKE '%cartela%'
                 GROUP  BY p4.name
                 ORDER  BY SUM(o5.quantity) DESC
                 LIMIT  1
               ) || '%'
             )
    ) AS top_product_cartela

  FROM public.orders o
  JOIN public.products p ON p.id = o.product_id
  GROUP BY o.client_id, o.month, o.year
)
SELECT
  c.id                                                          AS client_id,
  c.name                                                        AS client_name,
  c.partner_id,
  c.current_status,
  COALESCE(c.salesperson_id, os.primary_salesperson_id)        AS salesperson_id,
  COALESCE(csp.name,         psp.name)                         AS salesperson_name,
  COALESCE(csp.code,         psp.code)                         AS salesperson_code,
  os.month,
  os.year,
  COALESCE(os.total_meters,      0)                            AS total_meters,
  COALESCE(os.cartela_count,     0)                            AS cartela_count,
  COALESCE(os.top_product_cartela, 0)                          AS top_product_cartela,
  COALESCE(os.unique_products,   0)                            AS unique_products,
  os.top_product_name,
  CASE
    WHEN COALESCE(os.total_meters, 0) = 0    THEN 'RED'
    WHEN COALESCE(os.total_meters, 0) < 100  THEN 'ORANGE'
    ELSE                                          'GREEN'
  END AS level

FROM       public.clients      c
JOIN       order_summary       os  ON  c.id              = os.client_id
LEFT JOIN  public.salespersons csp ON  c.salesperson_id  = csp.id
LEFT JOIN  public.salespersons psp ON  os.primary_salesperson_id = psp.id;

-- ── Verify ───────────────────────────────────────────────────────────
SELECT
  client_name,
  salesperson_name,
  top_product_name,
  total_meters,
  cartela_count,
  top_product_cartela,
  level
FROM public.client_monthly_metrics
LIMIT 10;
