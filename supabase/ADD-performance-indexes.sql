-- Performance indexes for common dashboard/sales/urgent queries.
-- Safe to run multiple times.

create index if not exists idx_orders_month_year_salesperson
  on public.orders (month, year, salesperson_id);

create index if not exists idx_orders_month_year_client
  on public.orders (month, year, client_id);

create index if not exists idx_orders_salesperson_month_year
  on public.orders (salesperson_id, month, year);

create index if not exists idx_clients_salesperson_type
  on public.clients (salesperson_id, customer_type);

create index if not exists idx_clients_type_name
  on public.clients (customer_type, name);

-- NOTE:
-- client_monthly_metrics is a VIEW, so Postgres does not allow creating indexes on it.
-- Add indexes on underlying base tables used by the view instead.
create index if not exists idx_orders_year_month_salesperson_client
  on public.orders (year, month, salesperson_id, client_id);

create index if not exists idx_orders_client_year_month
  on public.orders (client_id, year, month);

create index if not exists idx_clients_id_salesperson_type
  on public.clients (id, salesperson_id, customer_type);
