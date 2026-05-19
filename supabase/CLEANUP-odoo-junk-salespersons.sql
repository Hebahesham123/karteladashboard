-- ============================================================
-- CLEANUP: Repair orders synced from Odoo that were pointed at
-- the wrong "salesperson" (actually the invoice author, e.g.
-- "Administrator", "Islam Ashraf (Odoo System Admin)", branch
-- accountants, etc.) — and remove those junk salesperson rows.
--
-- After this:
--   - Each affected order points to the same salesperson_id as
--     its client's `clients.salesperson_id` (the real rep).
--   - The "junk" salesperson rows that have ZERO real assignments
--     left are deleted.
-- ============================================================

BEGIN;

-- 1) Identify likely-junk salespersons by name pattern.
--    These are the "invoice user" names that came in via the Odoo sync.
--    Tweak the patterns to match anything else you spot.
CREATE TEMP TABLE _junk_sp AS
SELECT id, name FROM public.salespersons
WHERE name ILIKE '%administrator%'
   OR name ILIKE '%odoo system admin%'
   OR name ILIKE '%(b. accountant)%'
   OR name ILIKE '%(محاسب فرع)%'
   OR name ILIKE '%(e-commerce manager)%';

-- 2) For every order whose salesperson_id is one of these junk ids,
--    re-point it to the salesperson_id stored on the client (the real rep).
UPDATE public.orders o
SET salesperson_id = c.salesperson_id
FROM public.clients c
WHERE o.client_id = c.id
  AND o.salesperson_id IN (SELECT id FROM _junk_sp);

-- 3) Now delete any junk salesperson row that no order or client still references.
DELETE FROM public.salespersons sp
WHERE sp.id IN (SELECT id FROM _junk_sp)
  AND NOT EXISTS (SELECT 1 FROM public.orders  o WHERE o.salesperson_id  = sp.id)
  AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.salesperson_id  = sp.id);

DROP TABLE _junk_sp;

-- 4) Refresh the MV so the dashboard / clients page picks up the new mapping.
SELECT public.refresh_analytics_materialized_views();

COMMIT;

-- Verification: any remaining "Administrator"-style names?
-- SELECT id, code, name FROM public.salespersons
-- WHERE name ILIKE '%administrator%' OR name ILIKE '%odoo system admin%';

-- Spot-check: synced May 2026 orders should now show the client's real rep.
-- SELECT o.invoice_ref, c.name AS client, sp.name AS salesperson_now
-- FROM public.orders o
-- JOIN public.clients c ON c.id = o.client_id
-- LEFT JOIN public.salespersons sp ON sp.id = o.salesperson_id
-- WHERE o.month = 5 AND o.year = 2026
-- LIMIT 10;
