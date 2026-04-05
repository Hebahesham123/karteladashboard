-- ============================================================
-- Clear all uploaded data — keeps users & table structure
-- Run in: Supabase → SQL Editor → Paste → Run
-- ============================================================

-- Disable triggers temporarily to avoid FK issues
SET session_replication_role = replica;

TRUNCATE TABLE public.activity_logs          RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.client_status_history  RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.upload_batches         RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.orders                 RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.clients                RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.products               RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.salespersons           RESTART IDENTITY CASCADE;

-- Re-enable triggers
SET session_replication_role = DEFAULT;

-- Confirm
SELECT
  'orders'               AS table_name, COUNT(*) AS rows FROM public.orders          UNION ALL
SELECT 'clients',                                  COUNT(*) FROM public.clients         UNION ALL
SELECT 'products',                                 COUNT(*) FROM public.products        UNION ALL
SELECT 'salespersons',                             COUNT(*) FROM public.salespersons    UNION ALL
SELECT 'upload_batches',                           COUNT(*) FROM public.upload_batches  UNION ALL
SELECT 'activity_logs',                            COUNT(*) FROM public.activity_logs;
