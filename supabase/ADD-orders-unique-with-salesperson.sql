-- Invoice lines for the same client + product + month can be sold by different reps.
-- Previously UNIQUE (client_id, product_id, month, year) caused later lines to overwrite
-- earlier ones, and UI filters on orders.salesperson_id hid lines where the rep differed
-- from the client's assigned salesperson.

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_client_product_month_year_unique;

-- One row per (client, product, month, year, salesperson). NULL reps share one slot.
CREATE UNIQUE INDEX IF NOT EXISTS orders_client_product_month_year_sp_uidx
  ON public.orders (client_id, product_id, month, year, salesperson_id)
  NULLS NOT DISTINCT;
