-- Repair any state where the post-images bucket or its INSERT policy ended up
-- missing or misconfigured.  Fully idempotent — safe to apply multiple times.
--
-- Symptoms this fixes:
--   "You don't have permission to publish this."
--   Caused by: authenticated user uploading to storage.objects with an expired
--   JWT or no token, so Supabase fell back to the anon role, the
--   "TO authenticated" INSERT policy did not fire, and PostgreSQL returned
--   "permission denied for table objects".

-- ── Bucket: ensure post-images exists and is private ────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('post-images', 'post-images', false, 209715200, NULL)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit;

-- ── Storage policies: post-images ───────────────────────────────────────────
DROP POLICY IF EXISTS "Users can upload post images to their folder" ON storage.objects;
CREATE POLICY "Users can upload post images to their folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'post-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update their own post images" ON storage.objects;
CREATE POLICY "Users can update their own post images"
  ON storage.objects FOR UPDATE TO authenticated
  USING  (bucket_id = 'post-images' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'post-images' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can delete their own post images" ON storage.objects;
CREATE POLICY "Users can delete their own post images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'post-images' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ── Storage policies: avatars ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── posts table: INSERT policy ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can create their own posts" ON public.posts;
CREATE POLICY "Users can create their own posts"
  ON public.posts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id);
