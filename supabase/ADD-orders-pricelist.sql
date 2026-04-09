-- Odoo export: Pricelist (e.g. VIP (EGP), تجاري (EGP))
-- Run once in Supabase SQL Editor after ADD-orders-category-invoice-ref.sql (or any orders migration).

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pricelist TEXT;

COMMENT ON COLUMN public.orders.pricelist IS 'Pricelist name from import (e.g. Odoo Invoice lines / Pricelist).';

CREATE INDEX IF NOT EXISTS idx_orders_pricelist
  ON public.orders (pricelist)
  WHERE pricelist IS NOT NULL AND btrim(pricelist) <> '';
