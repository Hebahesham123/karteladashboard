-- Optional: fast branch aggregates for /api/branches (run once in Supabase SQL Editor).
-- If not applied, the API falls back to a chunked scan.

create or replace function public.branch_order_stats()
returns table(branch text, order_count bigint, total_revenue numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when coalesce(trim(o.branch), '') = '' then null::text else trim(o.branch) end as branch,
    count(*)::bigint,
    coalesce(sum(o.invoice_total), 0)::numeric
  from public.orders o
  group by case when coalesce(trim(o.branch), '') = '' then null::text else trim(o.branch) end
  order by count(*) desc;
$$;
