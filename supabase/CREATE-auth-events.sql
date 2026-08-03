-- Login / logout audit log.
-- Insert path is protected by requiring an authenticated JWT that matches user_id.
-- Read path is admin-only.
-- Run in Supabase SQL editor.
BEGIN;

CREATE TABLE IF NOT EXISTS public.auth_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text NOT NULL,
  event       text NOT NULL CHECK (event IN ('login', 'logout')),
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_events_created_at_idx
  ON public.auth_events (created_at DESC);
CREATE INDEX IF NOT EXISTS auth_events_user_id_created_at_idx
  ON public.auth_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_events_email_created_at_idx
  ON public.auth_events (lower(email), created_at DESC);

ALTER TABLE public.auth_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_events_insert_self ON public.auth_events;
CREATE POLICY auth_events_insert_self
  ON public.auth_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS auth_events_select_admin ON public.auth_events;
CREATE POLICY auth_events_select_admin
  ON public.auth_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

COMMIT;
