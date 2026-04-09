-- Category + invoice / journal reference (فاتوره) on orders; extend uniqueness per invoice line.
-- Run once in Supabase SQL Editor after prior order migrations.
-- Pricelist (Odoo column "Pricelist"): run ADD-orders-pricelist.sql after this.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS invoice_ref TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.orders.category IS 'Category from import (e.g. Odoo product category).';
COMMENT ON COLUMN public.orders.invoice_ref IS 'Invoice or journal entry reference (فاتوره).';

CREATE INDEX IF NOT EXISTS idx_orders_category
  ON public.orders (category)
  WHERE category IS NOT NULL AND btrim(category) <> '';

CREATE INDEX IF NOT EXISTS idx_orders_invoice_ref
  ON public.orders (invoice_ref)
  WHERE btrim(invoice_ref) <> '';

DROP INDEX IF EXISTS orders_client_product_month_year_sp_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS orders_client_product_month_year_sp_inv_uidx
  ON public.orders (client_id, product_id, month, year, salesperson_id, invoice_ref)
  NULLS NOT DISTINCT;
