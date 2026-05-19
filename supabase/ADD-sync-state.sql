-- ============================================================
-- sync_state — tracks last successful sync per external source
-- (Odoo analytics API, etc.)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sync_state (
  source             TEXT PRIMARY KEY,
  last_sync_at       TIMESTAMPTZ,            -- last successful end-of-window
  last_run_at        TIMESTAMPTZ,            -- last run regardless of status
  last_status        TEXT,                   -- 'success' | 'error' | 'running'
  last_message       TEXT,
  records_processed  INTEGER NOT NULL DEFAULT 0,
  records_failed     INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_state admin read" ON public.sync_state;
CREATE POLICY "sync_state admin read" ON public.sync_state
  FOR SELECT USING (public.get_user_role() = 'admin');

-- Seed the odoo row so reads never get a NULL.
INSERT INTO public.sync_state (source, last_status, last_message)
VALUES ('odoo', 'never_run', 'Awaiting first sync')
ON CONFLICT (source) DO NOTHING;
