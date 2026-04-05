-- ============================================================
-- Fix client_monthly_metrics view
-- Adds: salesperson fallback from orders, top_product_name
-- Run this in Supabase → SQL Editor
-- ============================================================

DROP VIEW IF EXISTS public.client_monthly_metrics;

CREATE VIEW public.client_monthly_metrics AS
WITH order_summary AS (
  SELECT
    o.client_id,
    o.month,
    o.year,
    SUM(o.quantity)            AS total_meters,
    COUNT(DISTINCT o.product_id) AS unique_products,

    -- Primary salesperson: whichever handled the most meters this month
    (
      SELECT o2.salesperson_id
      FROM   public.orders o2
      WHERE  o2.client_id = o.client_id
        AND  o2.month     = o.month
        AND  o2.year      = o.year
        AND  o2.salesperson_id IS NOT NULL
      GROUP  BY o2.salesperson_id
      ORDER  BY SUM(o2.quantity) DESC
      LIMIT  1
    ) AS primary_salesperson_id,

    -- Top product: highest total quantity this month
    (
      SELECT p.name
      FROM   public.orders o3
      JOIN   public.products p ON p.id = o3.product_id
      WHERE  o3.client_id = o.client_id
        AND  o3.month     = o.month
        AND  o3.year      = o.year
      GROUP  BY p.name
      ORDER  BY SUM(o3.quantity) DESC
      LIMIT  1
    ) AS top_product_name

  FROM public.orders o
  GROUP BY o.client_id, o.month, o.year
)
SELECT
  c.id               AS client_id,
  c.name             AS client_name,
  c.partner_id,
  c.current_status,

  -- Salesperson: prefer client's own, fall back to whoever handled orders
  COALESCE(c.salesperson_id,  os.primary_salesperson_id)  AS salesperson_id,
  COALESCE(csp.name,          psp.name)                   AS salesperson_name,
  COALESCE(csp.code,          psp.code)                   AS salesperson_code,

  os.month,
  os.year,
  COALESCE(os.total_meters,   0)   AS total_meters,
  COALESCE(os.unique_products, 0)  AS unique_products,
  os.top_product_name,

  CASE
    WHEN COALESCE(os.total_meters, 0) = 0    THEN 'RED'
    WHEN COALESCE(os.total_meters, 0) < 100  THEN 'ORANGE'
    ELSE                                          'GREEN'
  END AS level

FROM       public.clients      c
JOIN       order_summary       os  ON c.id = os.client_id
LEFT JOIN  public.salespersons csp ON c.salesperson_id            = csp.id
LEFT JOIN  public.salespersons psp ON os.primary_salesperson_id   = psp.id;
