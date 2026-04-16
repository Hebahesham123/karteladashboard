-- Per-order follow-up status for urgent assignments (does not replace clients.current_status).
-- Run once in Supabase SQL editor.

alter table public.urgent_order_assignments
  add column if not exists client_status public.client_status null;

create index if not exists idx_uoa_salesperson_order_active
  on public.urgent_order_assignments (salesperson_id, order_id)
  where is_active = true;
