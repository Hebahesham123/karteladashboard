-- Urgent orders assigned by admin to salespersons
create table if not exists public.urgent_order_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  salesperson_id uuid not null references public.salespersons(id) on delete cascade,
  assigned_by uuid not null references public.users(id) on delete cascade,
  note text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, salesperson_id)
);

create index if not exists idx_uoa_salesperson_active
  on public.urgent_order_assignments (salesperson_id, is_active);

create index if not exists idx_uoa_order
  on public.urgent_order_assignments (order_id);

create or replace function public.set_uoa_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_uoa_updated_at on public.urgent_order_assignments;
create trigger trg_uoa_updated_at
before update on public.urgent_order_assignments
for each row execute function public.set_uoa_updated_at();
