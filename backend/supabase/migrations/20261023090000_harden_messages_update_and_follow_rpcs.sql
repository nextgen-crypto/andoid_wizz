-- Hardening pass driven by the pre-launch security review.
--
-- 1. messages UPDATE: "Recipients can mark messages read" only checked
--    uid <> sender, so any authenticated user who learned a message UUID
--    could rewrite that message's body. Mirror the participant predicate the
--    SELECT/INSERT policies already use, and narrow the column grant to
--    is_read so even conversation participants cannot rewrite each other's
--    message text.
-- 2. get_follow_counts / get_follow_list were executable by anon, letting
--    unauthenticated callers enumerate the follower list of a private
--    account. The frontend only calls them signed in (and falls back to
--    RLS-filtered direct queries when an RPC errors), so anon is revoked;
--    the list RPC additionally hides a private account's list from everyone
--    except the account itself and its approved followers.

DROP POLICY IF EXISTS "Recipients can mark messages read" ON public.messages;
CREATE POLICY "Recipients can mark messages read"
  ON public.messages FOR UPDATE TO authenticated
  USING (
    auth.uid() <> sender_id
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (auth.uid() = c.user_a_id OR auth.uid() = c.user_b_id)
    )
  )
  WITH CHECK (
    auth.uid() <> sender_id
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (auth.uid() = c.user_a_id OR auth.uid() = c.user_b_id)
    )
  );

REVOKE UPDATE ON public.messages FROM authenticated;
GRANT UPDATE (is_read) ON public.messages TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_follow_counts(UUID) FROM anon;

CREATE OR REPLACE FUNCTION public.get_follow_list(target_user_id UUID, list_kind TEXT)
RETURNS TABLE (
  id UUID,
  username TEXT,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  verified BOOLEAN,
  is_private BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.id, p.username, p.display_name, p.bio, p.avatar_url, p.verified, p.is_private
  FROM public.profiles p
  WHERE EXISTS (
      SELECT 1 FROM public.profiles t
      WHERE t.id = target_user_id
        AND (
          t.is_private = false
          OR t.id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.followee_id = t.id AND f.follower_id = auth.uid()
          )
        )
    )
    AND p.id IN (
      SELECT CASE
        WHEN list_kind = 'followers' THEN f.follower_id
        ELSE f.followee_id
      END
      FROM public.follows f
      WHERE (list_kind = 'followers' AND f.followee_id = target_user_id)
         OR (list_kind = 'following' AND f.follower_id = target_user_id)
    )
  ORDER BY p.display_name;
$$;

REVOKE EXECUTE ON FUNCTION public.get_follow_list(UUID, TEXT) FROM anon;
