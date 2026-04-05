-- ============================================================
-- FIX: Remove duplicate orders + add indexes + unique constraint
-- Run this ONCE in Supabase SQL editor.
-- This fixes:
--   1. Duplicate orders from multiple Excel uploads (inflates meter counts)
--   2. Slow query / view timeout (missing indexes)
-- ============================================================

-- ── STEP 1: Check how many duplicates exist ───────────────────────────────
-- Run this first to see the scale of duplicates
SELECT
  COUNT(*) AS total_orders,
  COUNT(*) - COUNT(DISTINCT (client_id::text || product_id::text || month::text || year::text)) AS duplicate_rows_approx
FROM public.orders;

-- ── STEP 2: Remove duplicate orders ──────────────────────────────────────
-- Keep only the row with the HIGHEST id (most recent upload) for each
-- unique (client_id, product_id, month, year) combination.
-- The quantity for that row is the authoritative value.
DELETE FROM public.orders
WHERE id NOT IN (
  SELECT MAX(id::text)::uuid
  FROM public.orders
  GROUP BY client_id, product_id, month, year
);

-- Verify how many rows remain
SELECT COUNT(*) AS orders_after_dedup FROM public.orders;

-- ── STEP 3: Add unique constraint to prevent future duplicates ────────────
-- This makes the upload UPSERT work correctly going forward.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_client_product_month_year_unique;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_client_product_month_year_unique
  UNIQUE (client_id, product_id, month, year);

-- ── STEP 4: Add performance indexes ──────────────────────────────────────
-- These are critical for the view to run fast without timeout.

-- Index for filtering by month+year (most common dashboard query)
CREATE INDEX IF NOT EXISTS idx_orders_month_year
  ON public.orders(month, year);

-- Index for joining orders → clients
CREATE INDEX IF NOT EXISTS idx_orders_client_id
  ON public.orders(client_id);

-- Index for joining orders → products
CREATE INDEX IF NOT EXISTS idx_orders_product_id
  ON public.orders(product_id);

-- Composite index for the main view query pattern
CREATE INDEX IF NOT EXISTS idx_orders_client_month_year
  ON public.orders(client_id, month, year);

-- Index for salesperson filtering
CREATE INDEX IF NOT EXISTS idx_orders_salesperson_id
  ON public.orders(salesperson_id);

-- Index on products name for ILIKE pattern matching (kartela detection)
CREATE INDEX IF NOT EXISTS idx_products_name_lower
  ON public.products(lower(name));

-- ── STEP 5: Verify March 2026 counts after dedup ─────────────────────────
SELECT level, COUNT(*) as count
FROM public.client_monthly_metrics
WHERE month = 3 AND year = 2026
GROUP BY level
ORDER BY level;
-- Expected (from Excel): GREEN≈229, ORANGE≈1898, RED≈9
