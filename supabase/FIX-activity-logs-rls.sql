-- ══════════════════════════════════════════════════════════════════════════════
-- FIX: RLS on activity_logs and client_status_history
-- Problem: Admins couldn't read logs created by sales users, and sales users
--          couldn't read logs created by other users for their own clients.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── 1. activity_logs ────────────────────────────────────────────────────────

-- Drop any existing select policies
DROP POLICY IF EXISTS "activity_logs_select" ON activity_logs;
DROP POLICY IF EXISTS "Users can read their own logs" ON activity_logs;
DROP POLICY IF EXISTS "admins_read_activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "sales_read_own_client_logs" ON activity_logs;
DROP POLICY IF EXISTS "Admins can read all activity logs" ON activity_logs;
DROP POLICY IF EXISTS "Sales can read logs for their clients" ON activity_logs;

-- Admins can read ALL logs
CREATE POLICY "Admins can read all activity logs"
  ON activity_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Sales users can read:
--   (a) logs they created themselves, OR
--   (b) logs for clients that belong to them
CREATE POLICY "Sales can read logs for their clients"
  ON activity_logs FOR SELECT
  USING (
    user_id = auth.uid()
    OR
    EXISTS (
      SELECT 1
      FROM clients c
      JOIN salespersons sp ON sp.id = c.salesperson_id
      WHERE c.id = activity_logs.entity_id::uuid
        AND sp.user_id = auth.uid()
    )
  );

-- ─── 2. client_status_history ────────────────────────────────────────────────

-- Drop any existing select policies
DROP POLICY IF EXISTS "client_status_history_select" ON client_status_history;
DROP POLICY IF EXISTS "Sales can read own clients history" ON client_status_history;
DROP POLICY IF EXISTS "admins_read_status_history" ON client_status_history;
DROP POLICY IF EXISTS "sales_read_own_client_status_history" ON client_status_history;
DROP POLICY IF EXISTS "Admins can read all status history" ON client_status_history;
DROP POLICY IF EXISTS "Sales can read status history for their clients" ON client_status_history;

-- Admins can read all status history
CREATE POLICY "Admins can read all status history"
  ON client_status_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Sales users can read:
--   (a) history they created themselves, OR
--   (b) history for clients that belong to them
CREATE POLICY "Sales can read status history for their clients"
  ON client_status_history FOR SELECT
  USING (
    changed_by = auth.uid()
    OR
    EXISTS (
      SELECT 1
      FROM clients c
      JOIN salespersons sp ON sp.id = c.salesperson_id
      WHERE c.id = client_status_history.client_id
        AND sp.user_id = auth.uid()
    )
  );

-- ─── 3. Make sure INSERT policies exist for sales users ──────────────────────

-- activity_logs INSERT (so sales can write logs)
DROP POLICY IF EXISTS "Users can insert activity logs" ON activity_logs;
DROP POLICY IF EXISTS "Authenticated users can insert activity logs" ON activity_logs;
CREATE POLICY "Authenticated users can insert activity logs"
  ON activity_logs FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- client_status_history INSERT (so sales can write history)
DROP POLICY IF EXISTS "Users can insert status history" ON client_status_history;
DROP POLICY IF EXISTS "Authenticated users can insert status history" ON client_status_history;
CREATE POLICY "Authenticated users can insert status history"
  ON client_status_history FOR INSERT
  WITH CHECK (changed_by = auth.uid());
