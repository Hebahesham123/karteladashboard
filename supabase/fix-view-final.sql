-- ============================================================
-- FINAL view — meters + cross-month كارتله with date
-- Run in: Supabase → SQL Editor → Paste → Run
-- ============================================================

DROP VIEW IF EXISTS public.client_monthly_metrics;

CREATE VIEW public.client_monthly_metrics AS
WITH
-- ── 1. Classify every order as meter or kartela ───────────────────────
classified AS (
  SELECT
    o.client_id,
    o.month,
    o.year,
    o.quantity,
    o.salesperson_id,
    p.name AS product_name,
    (p.name ILIKE '%كارتل%' OR p.name ILIKE '%cartela%') AS is_kartela,
    -- Base product name: strip kartela suffix so we can link across products
    TRIM(REGEXP_REPLACE(p.name,
      '\s*(كارتله|كارتلة|كارتيله|كارتيلة|cartela)\s*$',
      '', 'i')) AS base_product
  FROM public.orders o
  JOIN public.products p ON p.id = o.product_id
),

-- ── 2. Monthly meter summary (non-kartela only) ───────────────────────
meter_summary AS (
  SELECT
    client_id,
    month,
    year,
    SUM(quantity)                AS total_meters,
    COUNT(DISTINCT product_name) AS unique_products,

    -- Top product by meters this month
    (array_agg(product_name ORDER BY quantity DESC))[1] AS top_product_name,

    -- Primary salesperson
    (
      SELECT c2.salesperson_id
      FROM   classified c2
      WHERE  c2.client_id = c.client_id
        AND  c2.month     = c.month
        AND  c2.year      = c.year
        AND  c2.salesperson_id IS NOT NULL
      GROUP  BY c2.salesperson_id
      ORDER  BY SUM(c2.quantity) DESC
      LIMIT  1
    ) AS primary_salesperson_id

  FROM classified c
  WHERE NOT is_kartela
  GROUP BY client_id, month, year
),

-- ── 3. Best (top-qty) meter product per (client, month, year) ─────────
top_meter AS (
  SELECT DISTINCT ON (client_id, month, year)
    client_id,
    month,
    year,
    product_name AS top_product_name
  FROM classified
  WHERE NOT is_kartela
  ORDER BY client_id, month, year, quantity DESC
),

-- ── 4. Most-recent kartela per (client, base_product) across ALL months ─
latest_kartela AS (
  SELECT DISTINCT ON (client_id, base_product)
    client_id,
    base_product,
    month  AS kartela_month,
    year   AS kartela_year,
    SUM(quantity) OVER (PARTITION BY client_id, base_product, month, year) AS kartela_qty
  FROM classified
  WHERE is_kartela
  ORDER BY client_id, base_product, year DESC, month DESC
)

-- ── 5. Final SELECT ───────────────────────────────────────────────────
SELECT
  c.id                                                           AS client_id,
  c.name                                                         AS client_name,
  c.partner_id,
  c.current_status,
  COALESCE(c.salesperson_id, ms.primary_salesperson_id)          AS salesperson_id,
  COALESCE(csp.name,         psp.name)                           AS salesperson_name,
  COALESCE(csp.code,         psp.code)                           AS salesperson_code,
  ms.month,
  ms.year,
  COALESCE(ms.total_meters,    0)                                AS total_meters,
  COALESCE(ms.unique_products, 0)                                AS unique_products,
  tm.top_product_name,

  -- كارتله quantity (linked to top product, any month)
  COALESCE(lk.kartela_qty, 0)                                    AS cartela_count,
  COALESCE(lk.kartela_qty, 0)                                    AS top_product_cartela,

  -- When was the كارتله taken?
  lk.kartela_month,
  lk.kartela_year,

  -- Was it from a different month than the meters?
  CASE
    WHEN lk.kartela_month IS NULL                          THEN FALSE
    WHEN lk.kartela_month = ms.month
     AND lk.kartela_year  = ms.year                        THEN FALSE
    ELSE TRUE
  END AS kartela_cross_month,

  CASE
    WHEN COALESCE(ms.total_meters, 0) = 0    THEN 'RED'
    WHEN COALESCE(ms.total_meters, 0) < 100  THEN 'ORANGE'
    ELSE                                          'GREEN'
  END AS level

FROM       public.clients       c
JOIN       meter_summary        ms   ON  c.id              = ms.client_id
JOIN       top_meter            tm   ON  c.id              = tm.client_id
                                     AND ms.month          = tm.month
                                     AND ms.year           = tm.year
LEFT JOIN  public.salespersons  csp  ON  c.salesperson_id  = csp.id
LEFT JOIN  public.salespersons  psp  ON  ms.primary_salesperson_id = psp.id
LEFT JOIN  latest_kartela       lk   ON  lk.client_id      = c.id
                                     AND lk.base_product   = tm.top_product_name;

-- ── Verify ────────────────────────────────────────────────────────────
SELECT
  client_name, salesperson_name, month, year,
  top_product_name, total_meters,
  cartela_count, kartela_month, kartela_year, kartela_cross_month,
  level
FROM public.client_monthly_metrics
LIMIT 15;
