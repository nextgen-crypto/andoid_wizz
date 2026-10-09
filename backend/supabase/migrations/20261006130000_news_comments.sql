-- WIZZ Phase 2: real comments for news stories. Re-runnable.

CREATE TABLE IF NOT EXISTS public.news_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID REFERENCES public.news_stories(id) ON DELETE CASCADE,
  -- Fallback ref for seed/non-UUID threads (no FK); UUID stories prefer story_id.
  article_ref TEXT NOT NULL DEFAULT '',
  author_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.news_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS news_comments_story_idx
  ON public.news_comments (story_id, created_at DESC);
CREATE INDEX IF NOT EXISTS news_comments_ref_idx
  ON public.news_comments (article_ref, created_at DESC);

GRANT SELECT ON public.news_comments TO anon;
GRANT SELECT, INSERT, UPDATE ON public.news_comments TO authenticated;
GRANT ALL ON public.news_comments TO service_role;

ALTER TABLE public.news_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "News comments are viewable" ON public.news_comments;
CREATE POLICY "News comments are viewable"
  ON public.news_comments FOR SELECT USING (is_deleted = false);

DROP POLICY IF EXISTS "Authors can view their own news comments" ON public.news_comments;
CREATE POLICY "Authors can view their own news comments"
  ON public.news_comments FOR SELECT TO authenticated
  USING (auth.uid() = author_id);

DROP POLICY IF EXISTS "Users can comment as themselves" ON public.news_comments;
CREATE POLICY "Users can comment as themselves"
  ON public.news_comments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "Authors edit or hide their own news comments" ON public.news_comments;
CREATE POLICY "Authors edit or hide their own news comments"
  ON public.news_comments FOR UPDATE TO authenticated
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.news_comments;
