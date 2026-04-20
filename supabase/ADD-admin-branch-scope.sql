-- ============================================================
-- Explicit admin -> branch scope mapping
-- ============================================================
-- Run this after ADD-scoped-admins.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_branch_scope (
  admin_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  branch_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_user_id, branch_name)
);

CREATE INDEX IF NOT EXISTS idx_admin_branch_scope_admin
  ON public.admin_branch_scope(admin_user_id);

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.admin_branch_scope
TO authenticated, anon;

-- Clear and re-seed mapping from your provided WhatsApp list.
DELETE FROM public.admin_branch_scope
WHERE admin_user_id IN (
  SELECT id FROM public.users
  WHERE email IN (
    'youssef.ramzy@nstextile-eg.com',
    'ahmed.magdy.bedir@nstextile-eg.com',
    'ahmed.essam@nstextile-eg.com',
    'shenouda.samir@nstextile-eg.com',
    'abdelrahmanmagdy@nstextile-eg.com',
    'amr.elshenawy@nstextile-eg.com'
  )
);

INSERT INTO public.admin_branch_scope (admin_user_id, branch_name)
SELECT u.id, v.branch_name
FROM public.users u
JOIN (
  VALUES
    ('youssef.ramzy@nstextile-eg.com', 'Southgate'),
    ('youssef.ramzy@nstextile-eg.com', 'Mivida'),
    ('youssef.ramzy@nstextile-eg.com', 'Trivium zayed'),
    ('youssef.ramzy@nstextile-eg.com', 'Mall of arabia'),
    ('youssef.ramzy@nstextile-eg.com', 'Mall of egypt'),

    ('ahmed.magdy.bedir@nstextile-eg.com', 'Mall of Arabia'),
    ('ahmed.magdy.bedir@nstextile-eg.com', 'Mall of egypt'),
    ('ahmed.magdy.bedir@nstextile-eg.com', 'Trivium zayed'),

    ('ahmed.essam@nstextile-eg.com', 'Azhar 2'),
    ('ahmed.essam@nstextile-eg.com', 'Azhar 3'),
    ('ahmed.essam@nstextile-eg.com', 'Kal3a'),
    ('ahmed.essam@nstextile-eg.com', 'Moskey'),

    ('shenouda.samir@nstextile-eg.com', 'Faisel'),
    ('shenouda.samir@nstextile-eg.com', 'Helwan'),
    ('shenouda.samir@nstextile-eg.com', 'Hosery'),

    ('abdelrahmanmagdy@nstextile-eg.com', 'Nasr city'),
    ('abdelrahmanmagdy@nstextile-eg.com', 'Nozha'),
    ('abdelrahmanmagdy@nstextile-eg.com', 'Maadi'),

    ('amr.elshenawy@nstextile-eg.com', 'Tanta'),
    ('amr.elshenawy@nstextile-eg.com', 'Alexandria')
) AS v(email, branch_name)
ON lower(u.email) = lower(v.email);

COMMIT;
