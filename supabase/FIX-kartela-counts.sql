-- ============================================================
-- FIX: Remove inflated "assumed" kartela orders from the database
-- ============================================================
-- BACKGROUND:
--   Earlier versions of the upload code added 1 synthetic "kartela" order
--   (product = "{name} كارتله", quantity = 1) for every product a client
--   ordered meters from, even when there was no actual COLOR: كارتلة row
--   in the Excel file.  This inflated the cartela_count column.
--
-- WHAT THIS SCRIPT DOES:
--   It deletes every kartela order whose base product ALSO has a meter
--   order for the SAME client in the SAME month.  Those are the synthetic
--   (assumed) ones — real kartela samples in a different month are kept.
--
--   After running this, re-run EMERGENCY-recreate-view.sql to refresh the
--   view, then re-upload your Excel file so explicit COLOR: كارتلة rows
--   get stored correctly.
--
-- HOW TO USE:
--   1. Run this script in the Supabase SQL editor.
--   2. Check the count output — "kartela_orders_deleted" tells you how many
--      fake rows were removed.
--   3. Run EMERGENCY-recreate-view.sql (recreates the view without the
--      assumed-1 fallback).
--   4. Re-upload your Excel file in the app — the upload code now only
--      stores EXPLICIT kartela rows (COLOR: كارتلة in the Excel).
-- ============================================================

-- ── Step 1: Preview — how many assumed kartela orders exist? ──────────────
SELECT COUNT(*) AS assumed_kartela_to_delete
FROM public.orders k
JOIN public.products pk ON pk.id = k.product_id
WHERE (
  pk.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604)||chr(1607) || '%'  -- ends with كارتله
  OR pk.name ILIKE '%kartela%'
  OR pk.name ILIKE '%cartela%'
)
-- The matching meter product (same name without the كارتله suffix) also has
-- an order for the same client in the same month  →  assumed, not explicit
AND EXISTS (
  SELECT 1
  FROM public.orders m
  JOIN public.products pm ON pm.id = m.product_id
  WHERE m.client_id = k.client_id
    AND m.month     = k.month
    AND m.year      = k.year
    AND NOT (
      pm.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604)||chr(1607) || '%'
      OR pm.name ILIKE '%kartela%'
      OR pm.name ILIKE '%cartela%'
    )
    AND (
      -- base product name matches: "ROCK كارتله" → base is "ROCK"
      pk.name = pm.name || ' ' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604)||chr(1607)
      OR pk.name ILIKE pm.name || ' kartela'
      OR pk.name ILIKE pm.name || ' cartela'
    )
);

-- ── Step 2: Delete assumed kartela orders ─────────────────────────────────
-- (Only run after previewing the count above and confirming it looks correct)
DELETE FROM public.orders
WHERE id IN (
  SELECT k.id
  FROM public.orders k
  JOIN public.products pk ON pk.id = k.product_id
  WHERE (
    pk.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604)||chr(1607) || '%'
    OR pk.name ILIKE '%kartela%'
    OR pk.name ILIKE '%cartela%'
  )
  AND EXISTS (
    SELECT 1
    FROM public.orders m
    JOIN public.products pm ON pm.id = m.product_id
    WHERE m.client_id = k.client_id
      AND m.month     = k.month
      AND m.year      = k.year
      AND NOT (
        pm.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604)||chr(1607) || '%'
        OR pm.name ILIKE '%kartela%'
        OR pm.name ILIKE '%cartela%'
      )
      AND (
        pk.name = pm.name || ' ' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604)||chr(1607)
        OR pk.name ILIKE pm.name || ' kartela'
        OR pk.name ILIKE pm.name || ' cartela'
      )
  )
);

-- ── Step 3: Verify remaining kartela orders ───────────────────────────────
SELECT
  COUNT(*)                   AS kartela_orders_remaining,
  COUNT(DISTINCT k.client_id) AS unique_clients_with_kartela
FROM public.orders k
JOIN public.products pk ON pk.id = k.product_id
WHERE (
  pk.name LIKE '%' || chr(1603)||chr(1575)||chr(1585)||chr(1578)||chr(1604)||chr(1607) || '%'
  OR pk.name ILIKE '%kartela%'
  OR pk.name ILIKE '%cartela%'
);

-- ── Step 4: Quick check of the view after cleanup ─────────────────────────
SELECT level, COUNT(*) AS clients
FROM public.client_monthly_metrics
WHERE month = 3 AND year = 2026
GROUP BY level
ORDER BY level;
