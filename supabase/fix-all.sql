-- ============================================================
-- FIX ALL — Run this ONE file in Supabase → SQL Editor
-- Fixes: 1) salesperson on clients  2) view with product name
-- ============================================================

-- STEP 1: Copy salesperson from orders → clients (where missing)
UPDATE public.clients c
SET salesperson_id = (
  SELECT o.salesperson_id
  FROM   public.orders o
  WHERE  o.client_id        = c.id
    AND  o.salesperson_id  IS NOT NULL
  ORDER  BY o.year DESC, o.month DESC
  LIMIT  1
)
WHERE c.salesperson_id IS NULL;

-- Verify
SELECT COUNT(*) AS clients_with_salesperson
FROM   public.clients
WHERE  salesperson_id IS NOT NULL;

-- ============================================================
-- STEP 2: Rebuild the view with salesperson fallback + product
-- ============================================================

DROP VIEW IF EXISTS public.client_monthly_metrics;

CREATE VIEW public.client_monthly_metrics AS
WITH order_summary AS (
  SELECT
    o.client_id,
    o.month,
    o.year,
    SUM(o.quantity)              AS total_meters,
    COUNT(DISTINCT o.product_id) AS unique_products,

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

    -- Top product (highest total quantity this month)
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
  c.id                                                        AS client_id,
  c.name                                                      AS client_name,
  c.partner_id,
  c.current_status,
  COALESCE(c.salesperson_id,  os.primary_salesperson_id)      AS salesperson_id,
  COALESCE(csp.name,          psp.name)                       AS salesperson_name,
  COALESCE(csp.code,          psp.code)                       AS salesperson_code,
  os.month,
  os.year,
  COALESCE(os.total_meters,   0)                              AS total_meters,
  COALESCE(os.unique_products, 0)                             AS unique_products,
  os.top_product_name,
  CASE
    WHEN COALESCE(os.total_meters, 0) = 0   THEN 'RED'
    WHEN COALESCE(os.total_meters, 0) < 100 THEN 'ORANGE'
    ELSE                                         'GREEN'
  END AS level
FROM       public.clients      c
JOIN       order_summary        os  ON  c.id               = os.client_id
LEFT JOIN  public.salespersons  csp ON  c.salesperson_id   = csp.id
LEFT JOIN  public.salespersons  psp ON  os.primary_salesperson_id = psp.id;

-- Verify view works
SELECT client_name, salesperson_name, top_product_name, total_meters, level
FROM   public.client_monthly_metrics
LIMIT  10;
