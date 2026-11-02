-- WIZZ chunk: multi-photo (carousel) posts.
-- A post may carry up to 10 photos in `image_paths`; the legacy single
-- `image_path` keeps working as post #1 so old rows and old clients are
-- unaffected. Owner enforcement mirrors the single-path CHECK constraints:
-- every stored path must live under the author's own storage folder.
-- Fully re-runnable.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS image_paths TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_image_paths_owner_check;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_image_paths_owner_check
  CHECK (
    array_length(image_paths, 1) IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM unnest(public.posts.image_paths) AS p(path)
      WHERE split_part(p.path, '/', 1) <> author_id::text
    )
  );

-- Keep the array capped so one row can never balloon a feed page.
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_image_paths_limit;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_image_paths_limit
  CHECK (coalesce(array_length(image_paths, 1), 0) <= 10);

-- Backfill: promote existing single-image posts into the array so readers
-- only need to look at one column.
UPDATE public.posts
SET image_paths = ARRAY[image_path]
WHERE image_path <> ''
  AND coalesce(array_length(image_paths, 1), 0) = 0;

-- Feed pages read image_paths alongside the base columns; a plain btree on
-- the author keeps profile grids cheap without a GIN (arrays are read whole,
-- never queried by containment here).
CREATE INDEX IF NOT EXISTS posts_author_created_idx
  ON public.posts (author_id, created_at DESC);
