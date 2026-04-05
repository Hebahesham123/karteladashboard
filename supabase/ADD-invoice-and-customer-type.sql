-- ============================================================
-- ADD: invoice_total, customer_type, branch + update all views
-- Run this ONCE in the Supabase SQL Editor
-- ============================================================

-- ── 1. New columns ────────────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS invoice_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS branch        TEXT;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS customer_type TEXT;

-- ── 2. Index for customer_type filter ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_clients_customer_type ON public.clients(customer_type);
CREATE INDEX IF NOT EXISTS idx_orders_invoice_total  ON public.orders(invoice_total);

-- ── 3. Recreate client_monthly_metrics with revenue + order_count ─────────
DROP VIEW IF EXISTS public.client_monthly_metrics;

CREATE VIEW public.client_monthly_metrics AS
WITH
classified AS (
  SELECT
    o.client_id, o.month, o.year, o.quantity,
    COALESCE(o.invoice_total, 0) AS invoice_total,
    o.salesperson_id,
    p.name AS product_name,
    (
      p.name ILIKE '%kartela%' OR p.name ILIKE '%cartela%'
      OR p.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604) || '%'
    ) AS is_kartela
  FROM public.orders o
  JOIN public.products p ON p.id = o.product_id
),
all_activity AS (
  SELECT
    client_id, month, year,
    MAX(salesperson_id::text)::uuid AS primary_salesperson_id
  FROM classified
  GROUP BY client_id, month, year
),
meter_summary AS (
  SELECT
    client_id, month, year,
    SUM(quantity)                                         AS total_meters,
    SUM(invoice_total)                                    AS total_revenue,
    COUNT(*)                                              AS order_count,
    (array_agg(product_name ORDER BY quantity DESC))[1]   AS top_product_name
  FROM classified
  WHERE NOT is_kartela
  GROUP BY client_id, month, year
),
kartela_summary AS (
  SELECT client_id, month, year,
    SUM(quantity)      AS kartela_qty,
    SUM(invoice_total) AS kartela_revenue
  FROM classified
  WHERE is_kartela
  GROUP BY client_id, month, year
)
SELECT
  c.id                                                                       AS client_id,
  c.name                                                                     AS client_name,
  c.partner_id,
  c.current_status,
  c.customer_type,
  COALESCE(c.salesperson_id, aa.primary_salesperson_id)                     AS salesperson_id,
  sp.name                                                                    AS salesperson_name,
  sp.code                                                                    AS salesperson_code,
  aa.month,
  aa.year,
  COALESCE(ms.total_meters, 0)                                              AS total_meters,
  COALESCE(ms.total_revenue, 0)                                             AS total_revenue,
  COALESCE(ms.order_count, 0)                                               AS order_count,
  ms.top_product_name,
  COALESCE(ks.kartela_qty, 0)                                              AS cartela_count,
  COALESCE(ks.kartela_qty, 0)                                              AS top_product_cartela,
  ks.month                                                                   AS kartela_month,
  ks.year                                                                    AS kartela_year,
  CASE
    WHEN ks.month IS NULL                              THEN FALSE
    WHEN ks.month = aa.month AND ks.year = aa.year    THEN FALSE
    ELSE TRUE
  END                                                                        AS kartela_cross_month,
  CASE
    WHEN COALESCE(ms.total_meters, 0) = 0   THEN 'RED'
    WHEN COALESCE(ms.total_meters, 0) < 100 THEN 'ORANGE'
    ELSE                                         'GREEN'
  END                                                                        AS level
FROM       public.clients      c
JOIN       all_activity        aa  ON c.id = aa.client_id
LEFT JOIN  meter_summary       ms  ON ms.client_id = c.id AND ms.month = aa.month AND ms.year = aa.year
LEFT JOIN  kartela_summary     ks  ON ks.client_id = c.id AND ks.month = aa.month AND ks.year = aa.year
LEFT JOIN  public.salespersons sp  ON COALESCE(c.salesperson_id, aa.primary_salesperson_id) = sp.id;

-- ── 4. Recreate salesperson_performance with revenue + order_count ────────
DROP VIEW IF EXISTS public.salesperson_performance;

CREATE VIEW public.salesperson_performance AS
SELECT
  sp.id                                AS salesperson_id,
  sp.name                              AS salesperson_name,
  sp.code                              AS salesperson_code,
  o.month,
  o.year,
  COUNT(DISTINCT o.client_id)          AS active_clients,
  COALESCE(SUM(CASE
    WHEN (
      p.name ILIKE '%kartela%'
      OR p.name ILIKE '%cartela%'
      OR p.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604) || '%'
    ) THEN 0
    ELSE o.quantity
  END), 0)                             AS total_meters,
  COALESCE(SUM(CASE
    WHEN (
      p.name ILIKE '%kartela%'
      OR p.name ILIKE '%cartela%'
      OR p.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604) || '%'
    ) THEN 0
    ELSE COALESCE(o.invoice_total, 0)
  END), 0)                             AS total_revenue,
  COUNT(DISTINCT CASE
    WHEN (
      p.name ILIKE '%kartela%'
      OR p.name ILIKE '%cartela%'
      OR p.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604) || '%'
    ) THEN NULL
    ELSE o.product_id
  END)                                 AS unique_products,
  COUNT(o.id)                          AS order_count
FROM public.salespersons sp
LEFT JOIN public.orders   o ON sp.id = o.salesperson_id
LEFT JOIN public.products p ON p.id  = o.product_id
GROUP BY sp.id, sp.name, sp.code, o.month, o.year;

-- ── 5. Recreate product_analytics with revenue ────────────────────────────
DROP VIEW IF EXISTS public.product_analytics;

CREATE VIEW public.product_analytics AS
SELECT
  p.id                           AS product_id,
  p.name                         AS product_name,
  o.month,
  o.year,
  NULL::UUID                     AS salesperson_id,
  COUNT(DISTINCT o.client_id)    AS unique_clients,
  COALESCE(SUM(o.quantity), 0)   AS total_meters,
  COALESCE(SUM(COALESCE(o.invoice_total, 0)), 0) AS total_revenue,
  COALESCE(AVG(o.quantity), 0)   AS avg_meters_per_order,
  COUNT(*)                       AS order_count
FROM public.products p
LEFT JOIN public.orders o ON p.id = o.product_id
WHERE NOT (
  p.name ILIKE '%kartela%'
  OR p.name ILIKE '%cartela%'
  OR p.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604) || '%'
)
GROUP BY p.id, p.name, o.month, o.year
UNION ALL
SELECT
  p.id,
  p.name,
  o.month,
  o.year,
  o.salesperson_id,
  COUNT(DISTINCT o.client_id),
  COALESCE(SUM(o.quantity), 0),
  COALESCE(SUM(COALESCE(o.invoice_total, 0)), 0),
  COALESCE(AVG(o.quantity), 0),
  COUNT(*)
FROM public.products p
JOIN  public.orders o ON p.id = o.product_id
WHERE o.salesperson_id IS NOT NULL
  AND NOT (
    p.name ILIKE '%kartela%'
    OR p.name ILIKE '%cartela%'
    OR p.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604) || '%'
  )
GROUP BY p.id, p.name, o.month, o.year, o.salesperson_id;

-- ── 6. Re-grant access ────────────────────────────────────────────────────
GRANT SELECT ON public.client_monthly_metrics  TO authenticated, anon;
GRANT SELECT ON public.salesperson_performance TO authenticated, anon;
GRANT SELECT ON public.product_analytics       TO authenticated, anon;

-- ── 7. Verify ─────────────────────────────────────────────────────────────
SELECT
  'client_monthly_metrics'   AS view_name,
  COUNT(*)                   AS rows,
  SUM(total_revenue)         AS total_revenue,
  SUM(order_count)           AS order_count
FROM public.client_monthly_metrics
UNION ALL
SELECT
  'salesperson_performance',
  COUNT(*),
  SUM(total_revenue),
  SUM(order_count)
FROM public.salesperson_performance WHERE total_meters > 0
UNION ALL
SELECT
  'product_analytics',
  COUNT(*),
  SUM(total_revenue),
  SUM(order_count)
FROM public.product_analytics WHERE salesperson_id IS NULL;
