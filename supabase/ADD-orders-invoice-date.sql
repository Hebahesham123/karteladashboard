-- Invoice line date from Excel (Journal / Odoo export), not upload time.
-- Run once in Supabase SQL Editor.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS invoice_date DATE;

COMMENT ON COLUMN public.orders.invoice_date IS 'Business date from Excel Date column (e.g. serial 46112); used for analytics.';

CREATE INDEX IF NOT EXISTS idx_orders_invoice_date ON public.orders(invoice_date);
