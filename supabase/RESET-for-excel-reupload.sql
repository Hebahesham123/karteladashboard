-- ============================================================
-- Reset data to re-upload Excel from scratch
-- Run in Supabase SQL Editor (or psql) as a role that can TRUNCATE.
--
-- Pick ONE section below. Do not run both.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- OPTION A — Orders + upload history only (recommended first)
-- Keeps clients, products, salespersons, users.
-- Matches what the admin API POST /api/admin/clear-orders does, plus full activity_logs clear.
-- Then re-upload Excel; upload will upsert clients/products/salespersons as needed.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- `orders` has a foreign key to `upload_batches`; truncating `upload_batches` alone fails.
-- List both tables in one TRUNCATE so PostgreSQL clears them together (same as CASCADE from orders to dependents).
TRUNCATE TABLE public.orders, public.upload_batches RESTART IDENTITY CASCADE;

-- Clear logs (optional: use DELETE ... WHERE entity_type = 'order' to keep other logs)
TRUNCATE TABLE public.activity_logs RESTART IDENTITY;

COMMIT;

-- Verify
SELECT 'orders' AS t, COUNT(*)::bigint FROM public.orders
UNION ALL SELECT 'upload_batches', COUNT(*) FROM public.upload_batches
UNION ALL SELECT 'activity_logs', COUNT(*) FROM public.activity_logs;


-- ═════════════════════════════════════════════════════════════
-- OPTION B — Full wipe of business data (fresh catalog)
-- Deletes ALL clients, products, salespersons, orders, uploads, logs.
-- KEEPS public.users (login accounts).
-- Run OPTION B in a NEW query tab AFTER you understand the impact.
-- ═════════════════════════════════════════════════════════════
/*
BEGIN;

SET LOCAL session_replication_role = replica;  -- skip FK checks during truncate (Supabase usually allows)

TRUNCATE TABLE public.urgent_order_assignments RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.orders, public.upload_batches RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.client_status_history RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.activity_logs RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.clients RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.products RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.salespersons RESTART IDENTITY CASCADE;

SET LOCAL session_replication_role = DEFAULT;

COMMIT;

SELECT 'users' AS t, COUNT(*)::bigint FROM public.users
UNION ALL SELECT 'salespersons', COUNT(*) FROM public.salespersons
UNION ALL SELECT 'clients', COUNT(*) FROM public.clients
UNION ALL SELECT 'products', COUNT(*) FROM public.products
UNION ALL SELECT 'orders', COUNT(*) FROM public.orders
UNION ALL SELECT 'upload_batches', COUNT(*) FROM public.upload_batches;
*/
