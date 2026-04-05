-- ============================================================
-- VIEW v2 — meters + cross-month كارتله using LATERAL join
-- Run in: Supabase → SQL Editor → Paste → Run
-- ============================================================

DROP VIEW IF EXISTS public.client_monthly_metrics;

CREATE VIEW public.client_monthly_metrics AS
WITH
-- 1. Tag every order as meter or kartela
classified AS (
  SELECT
    o.client_id, o.month, o.year, o.quantity, o.salesperson_id,
    p.name AS pname,
    (p.name ILIKE '%كارتل%' OR p.name ILIKE '%cartela%') AS is_k
  FROM public.orders o
  JOIN public.products p ON p.id = o.product_id
),

-- 2. Monthly meter totals per client
monthly AS (
  SELECT client_id, month, year,
    SUM(quantity)          AS total_meters,
    COUNT(DISTINCT pname)  AS unique_products
  FROM classified
  WHERE NOT is_k
  GROUP BY client_id, month, year
),

-- 3. Top product (highest total meters) per (client, month, year)
top_prod AS (
  SELECT DISTINCT ON (client_id, month, year)
    client_id, month, year, pname AS top_product
  FROM (
    SELECT client_id, month, year, pname, SUM(quantity) AS tot
    FROM classified
    WHERE NOT is_k
    GROUP BY client_id, month, year, pname
  ) s
  ORDER BY client_id, month, year, tot DESC
),

-- 4. Primary salesperson per (client, month, year)
prim_sp AS (
  SELECT DISTINCT ON (client_id, month, year)
    client_id, month, year, salesperson_id AS sp_id
  FROM classified
  WHERE salesperson_id IS NOT NULL
  ORDER BY client_id, month, year, quantity DESC
)

SELECT
  c.id                                                           AS client_id,
  c.name                                                         AS client_name,
  c.partner_id,
  c.current_status,
  COALESCE(c.salesperson_id, ps.sp_id)                          AS salesperson_id,
  COALESCE(csp.name,  psp.name)                                 AS salesperson_name,
  COALESCE(csp.code,  psp.code)                                 AS salesperson_code,
  m.month,
  m.year,
  COALESCE(m.total_meters,    0)                                AS total_meters,
  COALESCE(m.unique_products, 0)                                AS unique_products,
  tp.top_product                                                AS top_product_name,

  -- ── كارتله: look across ALL months for this client + top product ──
  -- LATERAL finds the most-recent month where a kartela order exists
  COALESCE(ak.k_qty,   0)   AS cartela_count,
  COALESCE(ak.k_qty,   0)   AS top_product_cartela,
  ak.k_month                AS kartela_month,
  ak.k_year                 AS kartela_year,

  CASE
    WHEN ak.k_month IS NULL                                  THEN FALSE
    WHEN ak.k_month = m.month AND ak.k_year = m.year         THEN FALSE
    ELSE TRUE
  END                                                            AS kartela_cross_month,

  CASE
    WHEN COALESCE(m.total_meters, 0) = 0    THEN 'RED'
    WHEN COALESCE(m.total_meters, 0) < 100  THEN 'ORANGE'
    ELSE                                         'GREEN'
  END                                                            AS level

FROM       public.clients       c
JOIN       monthly              m    ON  c.id = m.client_id
LEFT JOIN  top_prod             tp   ON  c.id = tp.client_id
                                     AND m.month = tp.month
                                     AND m.year  = tp.year
LEFT JOIN  prim_sp              ps   ON  c.id = ps.client_id
                                     AND m.month = ps.month
                                     AND m.year  = ps.year
LEFT JOIN  public.salespersons  csp  ON  csp.id = c.salesperson_id
LEFT JOIN  public.salespersons  psp  ON  psp.id = ps.sp_id

-- LATERAL: find most recent kartela across ANY month for this client's top product
LEFT JOIN LATERAL (
  SELECT
    SUM(o2.quantity)   AS k_qty,
    o2.month           AS k_month,
    o2.year            AS k_year
  FROM   public.orders   o2
  JOIN   public.products p2 ON p2.id = o2.product_id
  WHERE  o2.client_id = c.id
    AND  (p2.name ILIKE '%كارتل%' OR p2.name ILIKE '%cartela%')
    AND  p2.name ILIKE (tp.top_product || ' %')
  GROUP  BY o2.month, o2.year
  ORDER  BY o2.year DESC, o2.month DESC
  LIMIT  1
) ak ON tp.top_product IS NOT NULL;

-- ── Quick verify ─────────────────────────────────────────────────────
SELECT
  client_name, month, year,
  top_product_name, total_meters,
  cartela_count, kartela_month, kartela_year, kartela_cross_month,
  level
FROM public.client_monthly_metrics
ORDER BY total_meters DESC
LIMIT 15;
