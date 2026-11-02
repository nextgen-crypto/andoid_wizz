-- WIZZ: showcase_slides, app_settings, announcements
-- All three tables were previously missing from Supabase — slides and settings
-- existed only in the admin's browser localStorage, so they never reached native
-- devices. Creating them here lets admin changes propagate to every client.
-- Fully re-runnable.

-- ─── showcase_slides ────────────────────────────────────────────────────────
-- Home-screen brand carousel. Each row is one ad/promo slide.
-- Public read (everyone sees the banners); only admins can write.

CREATE TABLE IF NOT EXISTS public.showcase_slides (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL DEFAULT '',
  subtitle    TEXT        NOT NULL DEFAULT '',
  image_url   TEXT        NOT NULL DEFAULT '',
  bg_from     TEXT        NOT NULL DEFAULT '#171208',
  bg_to       TEXT        NOT NULL DEFAULT '#4a3413',
  accent      TEXT        NOT NULL DEFAULT '#f59e0b',
  cta         TEXT        NOT NULL DEFAULT 'Learn more',
  link_url    TEXT        NOT NULL DEFAULT '',
  active      BOOLEAN     NOT NULL DEFAULT true,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.showcase_slides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "showcase_slides_public_select" ON public.showcase_slides;
CREATE POLICY "showcase_slides_public_select"
  ON public.showcase_slides FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "showcase_slides_admin_all" ON public.showcase_slides;
CREATE POLICY "showcase_slides_admin_all"
  ON public.showcase_slides FOR ALL
  USING (EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS showcase_slides_active_order_idx
  ON public.showcase_slides (active, sort_order ASC, created_at DESC);

-- ─── app_settings ────────────────────────────────────────────────────────────
-- Key-value store for app-wide feature flags and maintenance mode.
-- One row per key (e.g. "config"). Public read so every client honours flags;
-- admin-only write.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key         TEXT        PRIMARY KEY,
  value       JSONB       NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        REFERENCES auth.users (id) ON DELETE SET NULL
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_public_select" ON public.app_settings;
CREATE POLICY "app_settings_public_select"
  ON public.app_settings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "app_settings_admin_all" ON public.app_settings;
CREATE POLICY "app_settings_admin_all"
  ON public.app_settings FOR ALL
  USING (EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid()));

-- ─── announcements ───────────────────────────────────────────────────────────
-- Admin-authored banners shown in the app shell.
-- Unauthenticated users may read published rows only.

CREATE TABLE IF NOT EXISTS public.announcements (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL DEFAULT '',
  message     TEXT        NOT NULL DEFAULT '',
  status      TEXT        NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'published', 'archived')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "announcements_public_select" ON public.announcements;
CREATE POLICY "announcements_public_select"
  ON public.announcements FOR SELECT
  USING (status = 'published');

DROP POLICY IF EXISTS "announcements_admin_all" ON public.announcements;
CREATE POLICY "announcements_admin_all"
  ON public.announcements FOR ALL
  USING (EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS announcements_status_created_idx
  ON public.announcements (status, created_at DESC);
