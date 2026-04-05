-- ============================================================
-- CLEAR ALL DATA — Safe reset to re-upload from scratch
-- Run this in the Supabase SQL Editor
-- ⚠️  This deletes ALL orders, clients, products, salespersons
--     and upload history. Schema stays intact.
-- ============================================================

-- Disable triggers temporarily to avoid cascade issues
SET session_replication_role = replica;

-- ── 1. Clear transaction / log tables first ───────────────────
TRUNCATE TABLE public.activity_logs        RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.client_status_history RESTART IDENTITY CASCADE;

-- ── 2. Clear orders (depends on clients, products, salespersons) ──
TRUNCATE TABLE public.orders              RESTART IDENTITY CASCADE;

-- ── 3. Clear upload batches ───────────────────────────────────
TRUNCATE TABLE public.upload_batches      RESTART IDENTITY CASCADE;

-- ── 4. Clear clients ──────────────────────────────────────────
TRUNCATE TABLE public.clients             RESTART IDENTITY CASCADE;

-- ── 5. Clear products ─────────────────────────────────────────
TRUNCATE TABLE public.products            RESTART IDENTITY CASCADE;

-- ── 6. Clear salespersons ─────────────────────────────────────
TRUNCATE TABLE public.salespersons        RESTART IDENTITY CASCADE;

-- Re-enable triggers
SET session_replication_role = DEFAULT;

-- ── 7. Verify everything is empty ────────────────────────────
SELECT 'orders'           AS table_name, COUNT(*) AS remaining FROM public.orders
UNION ALL
SELECT 'clients',                         COUNT(*) FROM public.clients
UNION ALL
SELECT 'products',                        COUNT(*) FROM public.products
UNION ALL
SELECT 'salespersons',                    COUNT(*) FROM public.salespersons
UNION ALL
SELECT 'upload_batches',                  COUNT(*) FROM public.upload_batches
UNION ALL
SELECT 'activity_logs',                   COUNT(*) FROM public.activity_logs;
