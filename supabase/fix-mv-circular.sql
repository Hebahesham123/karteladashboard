-- Fix circular reference between client_monthly_metrics view and its MV.
-- Rebuild MV from the raw aggregation (not via the wrapper view),
-- then put the scoped wrapper view back on top.

SET statement_timeout = '600s';

DROP VIEW              IF EXISTS public.client_monthly_metrics CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.client_monthly_metrics_mv CASCADE;

CREATE MATERIALIZED VIEW public.client_monthly_metrics_mv AS
WITH classified AS (
  SELECT
    o.client_id, o.month, o.year, o.quantity, o.salesperson_id,
    p.name AS product_name,
    (
      p.name ILIKE '%kartela%' OR p.name ILIKE '%cartela%'
      OR p.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604) || '%'
    ) AS is_kartela
  FROM public.orders o
  JOIN public.products p ON p.id = o.product_id
),
all_activity AS (
  SELECT client_id, month, year,
         MAX(salesperson_id::text)::uuid AS primary_salesperson_id
  FROM classified
  GROUP BY client_id, month, year
),
meter_summary AS (
  SELECT client_id, month, year,
         SUM(quantity) AS total_meters,
         (array_agg(product_name ORDER BY quantity DESC))[1] AS top_product_name
  FROM classified
  WHERE NOT is_kartela
  GROUP BY client_id, month, year
),
kartela_summary AS (
  SELECT client_id, month, year, SUM(quantity) AS kartela_qty
  FROM classified
  WHERE is_kartela
  GROUP BY client_id, month, year
)
SELECT
  c.id AS client_id, c.name AS client_name, c.partner_id, c.current_status,
  COALESCE(c.salesperson_id, aa.primary_salesperson_id) AS salesperson_id,
  sp.name AS salesperson_name, sp.code AS salesperson_code,
  aa.month, aa.year,
  COALESCE(ms.total_meters, 0) AS total_meters,
  ms.top_product_name,
  COALESCE(ks.kartela_qty, 0) AS cartela_count,
  COALESCE(ks.kartela_qty, 0) AS top_product_cartela,
  ks.month AS kartela_month, ks.year AS kartela_year,
  CASE
    WHEN ks.month IS NULL                            THEN FALSE
    WHEN ks.month = aa.month AND ks.year = aa.year   THEN FALSE
    ELSE TRUE
  END AS kartela_cross_month,
  CASE
    WHEN COALESCE(ms.total_meters, 0) = 0   THEN 'RED'
    WHEN COALESCE(ms.total_meters, 0) < 100 THEN 'ORANGE'
    ELSE                                         'GREEN'
  END AS level
FROM       public.clients      c
JOIN       all_activity        aa  ON c.id = aa.client_id
LEFT JOIN  meter_summary       ms  ON ms.client_id = c.id AND ms.month = aa.month AND ms.year = aa.year
LEFT JOIN  kartela_summary     ks  ON ks.client_id = c.id AND ks.month = aa.month AND ks.year = aa.year
LEFT JOIN  public.salespersons sp  ON COALESCE(c.salesperson_id, aa.primary_salesperson_id) = sp.id;

CREATE INDEX IF NOT EXISTS idx_cmmv_year_month ON public.client_monthly_metrics_mv (year, month);
CREATE INDEX IF NOT EXISTS idx_cmmv_client_id  ON public.client_monthly_metrics_mv (client_id);
CREATE INDEX IF NOT EXISTS idx_cmmv_salesperson_year_month ON public.client_monthly_metrics_mv (salesperson_id, year, month);

CREATE OR REPLACE VIEW public.client_monthly_metrics AS
SELECT *
FROM public.client_monthly_metrics_mv c
WHERE
  CASE
    WHEN public.get_user_role() = 'admin' AND public.admin_has_branch_scope() THEN
      EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.client_id = c.client_id
          AND o.month = c.month
          AND o.year = c.year
          AND public.can_access_branch(o.branch)
      )
    ELSE public.can_access_salesperson(c.salesperson_id)
  END;

GRANT SELECT ON public.client_monthly_metrics    TO authenticated, anon;
GRANT SELECT ON public.client_monthly_metrics_mv TO authenticated, anon;

SELECT COUNT(*) AS mv_rows FROM public.client_monthly_metrics_mv;
