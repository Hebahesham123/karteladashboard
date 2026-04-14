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

create index if not exists idx_client_monthly_metrics_scope
  on public.client_monthly_metrics (year, month, salesperson_id, customer_type);

create index if not exists idx_client_monthly_metrics_client_scope
  on public.client_monthly_metrics (client_id, year, month);
