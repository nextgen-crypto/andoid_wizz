-- Add receiver_id to messages so realtime subscriptions can filter by recipient
-- without scanning the conversations table on every INSERT.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS receiver_id uuid
  REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Backfill existing rows from their conversation
UPDATE public.messages m
SET receiver_id = CASE
  WHEN c.user_a_id = m.sender_id THEN c.user_b_id
  ELSE c.user_a_id
END
FROM public.conversations c
WHERE c.id = m.conversation_id AND m.receiver_id IS NULL;

CREATE INDEX IF NOT EXISTS messages_receiver_idx ON public.messages (receiver_id, created_at DESC);
