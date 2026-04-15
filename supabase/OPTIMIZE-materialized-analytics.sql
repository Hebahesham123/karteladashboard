-- Ultra-fast analytics read optimization
-- ------------------------------------------------------------
-- This script keeps your existing API/view names unchanged:
--   public.client_monthly_metrics
--   public.product_analytics
--   public.salesperson_performance
--
-- It creates materialized snapshots behind them, adds indexes,
-- then re-points the public views to select from the snapshots.
--
-- Run order:
-- 1) Execute this file once.
-- 2) After imports / major data updates, run:
--      select public.refresh_analytics_materialized_views();
-- ------------------------------------------------------------

-- 1) Build materialized views from current live views.
drop materialized view if exists public.client_monthly_metrics_mv;
create materialized view public.client_monthly_metrics_mv as
select * from public.client_monthly_metrics;

drop materialized view if exists public.product_analytics_mv;
create materialized view public.product_analytics_mv as
select * from public.product_analytics;

drop materialized view if exists public.salesperson_performance_mv;
create materialized view public.salesperson_performance_mv as
select * from public.salesperson_performance;

-- 2) Add safe conditional indexes on common filter/sort columns.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client_monthly_metrics_mv'
      and column_name = 'year'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client_monthly_metrics_mv'
      and column_name = 'month'
  ) then
    execute 'create index if not exists idx_cmmv_year_month on public.client_monthly_metrics_mv (year, month)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client_monthly_metrics_mv'
      and column_name = 'salesperson_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client_monthly_metrics_mv'
      and column_name = 'year'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client_monthly_metrics_mv'
      and column_name = 'month'
  ) then
    execute 'create index if not exists idx_cmmv_salesperson_year_month on public.client_monthly_metrics_mv (salesperson_id, year, month)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client_monthly_metrics_mv'
      and column_name = 'client_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client_monthly_metrics_mv'
      and column_name = 'year'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client_monthly_metrics_mv'
      and column_name = 'month'
  ) then
    execute 'create index if not exists idx_cmmv_client_year_month on public.client_monthly_metrics_mv (client_id, year, month)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'product_analytics_mv'
      and column_name = 'year'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'product_analytics_mv'
      and column_name = 'month'
  ) then
    execute 'create index if not exists idx_pamv_year_month on public.product_analytics_mv (year, month)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'product_analytics_mv'
      and column_name = 'salesperson_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'product_analytics_mv'
      and column_name = 'year'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'product_analytics_mv'
      and column_name = 'month'
  ) then
    execute 'create index if not exists idx_pamv_salesperson_year_month on public.product_analytics_mv (salesperson_id, year, month)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'product_analytics_mv'
      and column_name = 'product_name'
  ) then
    execute 'create index if not exists idx_pamv_product_name on public.product_analytics_mv (product_name)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'salesperson_performance_mv'
      and column_name = 'year'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'salesperson_performance_mv'
      and column_name = 'month'
  ) then
    execute 'create index if not exists idx_spmv_year_month on public.salesperson_performance_mv (year, month)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'salesperson_performance_mv'
      and column_name = 'salesperson_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'salesperson_performance_mv'
      and column_name = 'year'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'salesperson_performance_mv'
      and column_name = 'month'
  ) then
    execute 'create index if not exists idx_spmv_salesperson_year_month on public.salesperson_performance_mv (salesperson_id, year, month)';
  end if;
end $$;

-- 3) Keep the same public view names used by the app.
create or replace view public.client_monthly_metrics as
select * from public.client_monthly_metrics_mv;

create or replace view public.product_analytics as
select * from public.product_analytics_mv;

create or replace view public.salesperson_performance as
select * from public.salesperson_performance_mv;

-- 4) Grant read access (same as typical existing setup).
grant select on public.client_monthly_metrics to authenticated, anon;
grant select on public.product_analytics to authenticated, anon;
grant select on public.salesperson_performance to authenticated, anon;
grant select on public.client_monthly_metrics_mv to authenticated, anon;
grant select on public.product_analytics_mv to authenticated, anon;
grant select on public.salesperson_performance_mv to authenticated, anon;

-- 5) Refresh helper (run after uploads / data changes).
create or replace function public.refresh_analytics_materialized_views()
returns void
language plpgsql
security definer
as $$
begin
  refresh materialized view public.client_monthly_metrics_mv;
  refresh materialized view public.product_analytics_mv;
  refresh materialized view public.salesperson_performance_mv;
end;
$$;

-- optional sanity check:
-- select public.refresh_analytics_materialized_views();
