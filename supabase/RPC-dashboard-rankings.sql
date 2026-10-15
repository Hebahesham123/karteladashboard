-- ============================================================
-- Dashboard rankings, aggregated in Postgres
--
-- Why: the dashboard built its salesperson / product / client leaderboards by
--   paging every matching client_monthly_metrics row into the browser and
--   grouping them in JavaScript. Measured on live data that was 40s + 5s + 8.6s
--   for a single month and roughly two minutes for a three-month range, run one
--   after the other — the main reason the page takes "very long" to load.
--
--   It was also not reliably correct: .range() paging without an ORDER BY has
--   no stability guarantee, so pages could repeat and skip rows.
--
-- This returns the three leaderboards already grouped and sorted, as a few
-- dozen rows instead of thousands.
--
-- Filters mirror rankingCmmQuery() in the dashboard exactly, including the
-- `total_meters > 0` restriction every ranking applied.
--
-- p_months takes the month list the dashboard actually uses, so a
-- non-contiguous selection (January + March) stays exact.
--
-- Limit is generous on purpose: the UI shows 15 / 10 / 10 but drops excluded
-- names (house accounts, cashiers) afterwards in JS, so it needs headroom.
-- ============================================================

create or replace function public.get_dashboard_rankings(
  p_year        int,
  p_months      int[],
  p_salesperson uuid   default null,
  p_branches    text[] default null,
  p_cust_types  text[] default null,
  p_products    text[] default null,
  p_clients     uuid[] default null,
  p_limit       int    default 60
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with filtered as (
  select
    client_id,
    client_name,
    partner_id,
    salesperson_id,
    salesperson_name,
    salesperson_code,
    top_product_name,
    total_meters,
    total_revenue
  from public.client_monthly_metrics
  where year = p_year
    and month = any(p_months)
    and total_meters > 0
    and (p_salesperson is null or salesperson_id    = p_salesperson)
    and (p_branches    is null or order_import_branch = any(p_branches))
    and (p_cust_types  is null or customer_type     = any(p_cust_types))
    and (p_products    is null or top_product_name  = any(p_products))
    and (p_clients     is null or client_id         = any(p_clients))
),
sp as (
  select
    salesperson_id as id,
    coalesce(max(salesperson_name), max(salesperson_code), '—') as name,
    coalesce(max(salesperson_code), '')      as code,
    sum(total_meters)                        as meters,
    sum(total_revenue)                       as revenue,
    count(distinct client_id)                as clients
  from filtered
  where salesperson_id is not null
  group by salesperson_id
  order by sum(total_meters) desc
  limit p_limit
),
prod as (
  select
    top_product_name          as name,
    sum(total_meters)         as qty,
    sum(total_revenue)        as revenue,
    count(distinct client_id) as clients
  from filtered
  where top_product_name is not null
    and btrim(top_product_name) <> ''
  group by top_product_name
  order by sum(total_meters) desc
  limit p_limit
),
cli as (
  select
    client_id,
    coalesce(max(client_name), '—') as name,
    coalesce(max(partner_id), '')   as partner_id,
    sum(total_meters)               as meters,
    sum(total_revenue)              as revenue
  from filtered
  group by client_id
  order by sum(total_meters) desc
  limit p_limit
)
select jsonb_build_object(
  'salespersons', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'code', code,
      'meters', meters, 'revenue', revenue, 'clients', clients
    )) from sp), '[]'::jsonb),
  'products', coalesce((select jsonb_agg(jsonb_build_object(
      'name', name, 'qty', qty, 'revenue', revenue, 'clients', clients
    )) from prod), '[]'::jsonb),
  'clients', coalesce((select jsonb_agg(jsonb_build_object(
      'client_id', client_id, 'name', name, 'partner_id', partner_id,
      'meters', meters, 'revenue', revenue
    )) from cli), '[]'::jsonb)
);
$$;

grant execute on function public.get_dashboard_rankings(
  int, int[], uuid, text[], text[], text[], uuid[], int
) to authenticated, anon, service_role;

-- Supporting index: every dashboard query filters on these three columns, and
-- customer_type was not covered by any existing index.
create index if not exists idx_cmmv_year_month_custtype
  on public.client_monthly_metrics_mv (year, month, customer_type);

-- Verification — should return in well under a second:
-- select jsonb_pretty(public.get_dashboard_rankings(
--   2026, array[10], null, null, array['VIP','تجاري','جملة']
-- ));
