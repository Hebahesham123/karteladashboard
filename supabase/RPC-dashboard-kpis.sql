-- ============================================================
-- Dashboard KPIs RPC
-- ------------------------------------------------------------
-- Returns the FULL KPI payload for the dashboard in one round-trip.
-- All aggregation runs server-side on client_monthly_metrics, so:
--   * No 1000-row PostgREST cap on totals
--   * No JS-side summing of thousands of rows
--   * Exact numbers regardless of dataset size
--
-- Run this AFTER OPTIMIZE-materialized-analytics.sql so the underlying
-- view is fast (it reads via the materialized view).
--
-- Run order:
--   1) ADD-performance-indexes.sql
--   2) OPTIMIZE-materialized-analytics.sql
--   3) THIS FILE
-- ============================================================

create or replace function public.get_dashboard_kpis(
  p_from_year   int,
  p_from_month  int,
  p_to_year     int,
  p_to_month    int,
  p_salesperson uuid     default null,
  p_branches    text[]   default null,
  p_cust_types  text[]   default null,
  p_products    text[]   default null,
  p_clients     uuid[]   default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with
-- 1. Filter universe once
filtered as (
  select
    client_id,
    total_meters,
    total_revenue,
    order_count,
    cartela_count,
    level,
    month,
    year,
    customer_type
  from public.client_monthly_metrics
  where (year * 12 + month) between (p_from_year * 12 + p_from_month)
                                and (p_to_year   * 12 + p_to_month)
    and (p_salesperson is null or salesperson_id = p_salesperson)
    and (p_branches    is null or order_import_branch = any(p_branches))
    and (p_cust_types  is null or customer_type = any(p_cust_types))
    and (p_products    is null or top_product_name = any(p_products))
    and (p_clients     is null or client_id = any(p_clients))
),
-- 2. Per-client aggregates across the whole range
per_client as (
  select
    client_id,
    sum(total_meters)  as meters,
    sum(total_revenue) as revenue,
    sum(order_count)   as orders,
    sum(cartela_count) as cartela
  from filtered
  group by client_id
),
-- 3. Per-level aggregates (level is per row → aggregate raw)
per_level as (
  select
    level,
    sum(total_meters)  as meters,
    sum(order_count)   as orders
  from filtered
  group by level
),
-- 4. Monthly trend (one row per (year, month) in the range)
monthly_trend as (
  select
    year,
    month,
    sum(total_meters)  as meters,
    sum(total_revenue) as revenue,
    sum(order_count)   as orders,
    count(distinct client_id) filter (where total_meters > 0) as active_clients
  from filtered
  group by year, month
  order by year, month
),
-- 5. Top-line totals
totals as (
  select
    coalesce(sum(meters),  0) as total_meters,
    coalesce(sum(revenue), 0) as total_revenue,
    coalesce(sum(orders),  0) as total_orders,
    coalesce(sum(cartela), 0) as kartela_total,
    count(*) filter (where cartela > 0) as kartela_clients,
    count(*)                              as client_count_in_filter,
    count(*) filter (where meters >  0)   as active_clients,
    count(*) filter (where meters >= 100) as green_count,
    count(*) filter (where meters >  0
                       and meters <  100) as orange_count,
    count(*) filter (where meters =  0)   as red_count
  from per_client
)
select jsonb_build_object(
  'totalMeters',      (select total_meters    from totals),
  'totalRevenue',     (select total_revenue   from totals),
  'totalOrders',      (select total_orders    from totals),
  'kartelaTotal',     (select kartela_total   from totals),
  'kartelaClients',   (select kartela_clients from totals),
  'clientCount',      (select client_count_in_filter from totals),
  'activeClients',    (select active_clients  from totals),
  'greenCount',       (select green_count     from totals),
  'orangeCount',      (select orange_count    from totals),
  'redCount',         (select red_count       from totals),
  'levelMeters', jsonb_build_object(
      'GREEN',  coalesce((select meters from per_level where level = 'GREEN'),  0),
      'ORANGE', coalesce((select meters from per_level where level = 'ORANGE'), 0),
      'RED',    coalesce((select meters from per_level where level = 'RED'),    0)
  ),
  'levelOrders', jsonb_build_object(
      'GREEN',  coalesce((select orders from per_level where level = 'GREEN'),  0),
      'ORANGE', coalesce((select orders from per_level where level = 'ORANGE'), 0),
      'RED',    coalesce((select orders from per_level where level = 'RED'),    0)
  ),
  'monthlyTrend', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'year',          year,
        'month',         month,
        'meters',        meters,
        'revenue',       revenue,
        'orders',        orders,
        'activeClients', active_clients
      ) order by year, month) from monthly_trend),
      '[]'::jsonb
  )
);
$$;

-- Grants
grant execute on function public.get_dashboard_kpis(
  int, int, int, int, uuid, text[], text[], text[], uuid[]
) to authenticated, anon;

-- ============================================================
-- Quick test
-- ============================================================
-- select public.get_dashboard_kpis(
--   p_from_year  => 2026, p_from_month => 4,
--   p_to_year    => 2026, p_to_month   => 4
-- );
