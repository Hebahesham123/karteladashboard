-- One-time activation script:
-- Ensures all salespeople are active in both tables used by the app.

begin;

update public.salespersons
set is_active = true
where is_active is distinct from true;

update public.users
set is_active = true
where role = 'sales'
  and is_active is distinct from true;

commit;
