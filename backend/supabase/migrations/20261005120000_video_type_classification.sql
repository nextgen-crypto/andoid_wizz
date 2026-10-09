-- WIZZ chunk: automatic video type classification.
-- Portrait clips land in Shorts, landscape clips in Videos. The client
-- detects width/height during upload; the server keeps the final word via
-- this stored metadata so the UI cannot be spoofed by hand edits.
-- Fully re-runnable.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS video_width INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_height INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_content_type_check;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_content_type_check
  CHECK (content_type IN ('', 'short', 'video'));

-- Backfill: classify any legacy rows that already carry usable metadata.
-- Rows without stored dimensions stay '' and are treated as normal videos.
UPDATE public.posts
SET content_type = CASE
  WHEN video_height > 0 AND video_width::numeric / video_height::numeric < 0.95 THEN 'short'
  WHEN video_width > 0 AND video_height > 0 THEN 'video'
  ELSE content_type
END
WHERE content_type = '';

-- Server-side authority: never trust the client to pick its own lane.
-- Whatever arrives on insert/update is recomputed from the stored dims.
CREATE OR REPLACE FUNCTION public.posts_classify_video()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.video_url IS NOT NULL AND NEW.video_width > 0 AND NEW.video_height > 0 THEN
    NEW.content_type := CASE
      WHEN NEW.video_height::numeric / NEW.video_width::numeric > 1.05 THEN 'short'
      ELSE 'video'
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_classify_video_trigger ON public.posts;
CREATE TRIGGER posts_classify_video_trigger
  BEFORE INSERT OR UPDATE OF video_width, video_height, video_url ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.posts_classify_video();
