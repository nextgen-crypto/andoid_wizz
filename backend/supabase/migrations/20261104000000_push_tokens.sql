-- push_tokens: stores FCM registration tokens, one row per device token.
CREATE TABLE public.push_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token       text        NOT NULL,
  platform    text        NOT NULL DEFAULT 'android',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (token)
);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON public.push_tokens
  FOR ALL TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_tokens TO authenticated;
GRANT ALL ON public.push_tokens TO service_role;

CREATE INDEX push_tokens_user_idx ON public.push_tokens (user_id);
