-- Followers/following counts live-update: lets the follows table stream to the client.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.follows;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
