-- WIZZ chunk: story seen-state + server-side expiry hygiene.
--
-- `viewed` used to be hard-coded false in the rail: opening a story left no
-- trace, so rings never turned gray. story_views records one row per
-- viewer/story, enforced by RLS (you may only write your own view).
--
-- Expiration itself is already enforced at read time (the rail filters
-- story_expires_at > now()) and in the storage policies; the pg_cron job below
-- additionally archives long-expired story rows so the table can't grow
-- unbounded even when nobody loads the rail.
-- Fully re-runnable.

CREATE TABLE IF NOT EXISTS public.story_views (
  story_id UUID NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);

ALTER TABLE public.story_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "story_views_own_insert" ON public.story_views;
CREATE POLICY "story_views_own_insert"
  ON public.story_views FOR INSERT
  WITH CHECK (auth.uid() = viewer_id);

DROP POLICY IF EXISTS "story_views_own_select" ON public.story_views;
CREATE POLICY "story_views_own_select"
  ON public.story_views FOR SELECT
  USING (auth.uid() = viewer_id);

-- Story owners may see who viewed their story (viewer info screens).
DROP POLICY IF EXISTS "story_views_owner_select" ON public.story_views;
CREATE POLICY "story_views_owner_select"
  ON public.story_views FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = story_id AND p.author_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS story_views_viewer_idx
  ON public.story_views (viewer_id, viewed_at DESC);

-- Server-side hygiene: archive story rows older than 48h (they stop being
-- readable at 24h via the read filters; this just reclaims rows). Guarded on
-- pg_extension so non-Supabase/local databases no-op instead of erroring.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
    PERFORM cron.schedule(
      'wizz-archive-expired-stories',
      '17 3 * * *',
      $job$
      UPDATE public.posts
      SET status = 'archived', updated_at = now()
      WHERE content_kind = 'story'
        AND status = 'published'
        AND story_expires_at IS NOT NULL
        AND story_expires_at < now() - interval '48 hours'
      $job$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- pg_cron unavailable: read-time filtering still enforces 24h expiry.
  NULL;
END
$$;
