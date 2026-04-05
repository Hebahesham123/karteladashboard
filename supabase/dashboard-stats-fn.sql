-- ============================================================
-- Dashboard stats function — avoids row-limit issues
-- Supports: p_year = NULL (All Years), p_month = NULL (All Months)
-- Run in: Supabase → SQL Editor → Paste → Run
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_stats(
  p_year            INT  DEFAULT NULL,
  p_month           INT  DEFAULT NULL,
  p_salesperson_id  UUID DEFAULT NULL
)
RETURNS TABLE (
  total_meters    NUMERIC,
  unique_clients  BIGINT,
  green_clients   BIGINT,
  orange_clients  BIGINT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  -- Aggregate per client first (handles All Months / All Years by omitting filters)
  WITH client_totals AS (
    SELECT
      client_id,
      SUM(total_meters) AS total_m
    FROM public.client_monthly_metrics
    WHERE (p_year  IS NULL OR year  = p_year)
      AND (p_month IS NULL OR month = p_month)
      AND (p_salesperson_id IS NULL OR salesperson_id = p_salesperson_id::uuid)
    GROUP BY client_id
  )
  SELECT
    COALESCE(SUM(total_m),    0)                                    AS total_meters,
    COUNT(*)                                                         AS unique_clients,
    COUNT(*) FILTER (WHERE total_m >= 100)                          AS green_clients,
    COUNT(*) FILTER (WHERE total_m > 0 AND total_m < 100)           AS orange_clients
  FROM client_totals;
$$;

-- Test all-years
SELECT * FROM public.get_dashboard_stats();
-- Test specific year
SELECT * FROM public.get_dashboard_stats(2025);
-- Test specific year + month
SELECT * FROM public.get_dashboard_stats(2025, 3);
