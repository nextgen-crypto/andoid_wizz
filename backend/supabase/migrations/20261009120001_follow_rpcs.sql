-- SECURITY DEFINER RPCs for follow counts and lists.
-- These bypass RLS on the follows table so users always see their own
-- follower/following counts and lists, regardless of the other party's
-- privacy setting.

CREATE OR REPLACE FUNCTION public.get_follow_counts(target_user_id UUID)
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT json_build_object(
    'followers', (SELECT count(*) FROM public.follows WHERE followee_id = target_user_id),
    'following', (SELECT count(*) FROM public.follows WHERE follower_id = target_user_id)
  );
$$;

REVOKE ALL ON FUNCTION public.get_follow_counts(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_follow_counts(UUID) TO anon, authenticated;

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
  WHERE p.id IN (
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

REVOKE ALL ON FUNCTION public.get_follow_list(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_follow_list(UUID, TEXT) TO anon, authenticated;
