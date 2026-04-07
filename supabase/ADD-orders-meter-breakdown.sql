-- Per-color / variant meter lines from Excel (e.g. COLOR: 1) for kartela analysis drill-down.
-- JSON array: [{"label":"COLOR: 1","meters":1000.1}, ...]

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS meter_breakdown JSONB DEFAULT NULL;

COMMENT ON COLUMN public.orders.meter_breakdown IS 'Optional breakdown of quantity by variant/color from Excel upload.';
