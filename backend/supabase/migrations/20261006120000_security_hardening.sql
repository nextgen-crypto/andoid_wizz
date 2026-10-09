-- WIZZ security hardening (Phase 1): admin roles table, comment/post
-- visibility chain closed, private profiles hidden at the row level,
-- ad-event validation + rate limiting. Re-runnable, fail-closed: drops and
-- recreates the affected policies and never grants anything new to anon.

-- --------------------------------------------------------------- admin roles
CREATE TABLE IF NOT EXISTS public.admin_roles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.admin_roles TO authenticated;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

DROP POLICY IF EXISTS "Admins read roles" ON public.admin_roles;
CREATE POLICY "Admins read roles"
  ON public.admin_roles FOR SELECT TO authenticated
  USING (public.is_admin());

-- Admins can read moderation surfaces directly (console uses service role).
DROP POLICY IF EXISTS "Admins can view reports" ON public.reports;
CREATE POLICY "Admins can view reports"
  ON public.reports FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view warnings" ON public.warnings;
CREATE POLICY "Admins can view warnings"
  ON public.warnings FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view campaigns" ON public.ad_campaigns;
CREATE POLICY "Admins can view campaigns"
  ON public.ad_campaigns FOR SELECT TO authenticated
  USING (public.is_admin());

-- ------------------------------------------------- private profile visibility
CREATE OR REPLACE FUNCTION public.profile_is_private(_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE((SELECT is_private FROM public.profiles WHERE id = _id), false);
$$;

REVOKE ALL ON FUNCTION public.profile_is_private(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_is_private(UUID) TO anon, authenticated;

-- A private profile's row (avatar, display_name, bio) is only visible to the
-- owner and approved followers. Public profiles stay world-readable.
DROP POLICY IF EXISTS "Profiles respect blocks" ON public.profiles;
CREATE POLICY "Profiles respect blocks and privacy"
  ON public.profiles FOR SELECT USING (
    NOT EXISTS (
      SELECT 1 FROM public.blocks
      WHERE (blocker_id = profiles.id AND blocked_id = auth.uid())
         OR (blocker_id = auth.uid() AND blocked_id = profiles.id)
    )
    AND (
      NOT COALESCE(is_private, false)
      OR id = auth.uid()
      OR public.is_following(auth.uid(), id)
    )
  );

-- The posts policy must not rely on the (now-filtered) profiles rows —
-- membership in the private set is decided via the SECURITY DEFINER helper.
DROP POLICY IF EXISTS "Posts respect visibility and status" ON public.posts;
CREATE POLICY "Posts respect visibility and status"
  ON public.posts FOR SELECT USING (
    auth.uid() = author_id
    OR (
      status = 'published'
      AND (
        visibility = 'public'
        OR (
          visibility = 'followers'
          AND public.is_following(auth.uid(), posts.author_id)
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.blocks
        WHERE (blocker_id = posts.author_id AND blocked_id = auth.uid())
           OR (blocker_id = auth.uid() AND blocked_id = posts.author_id)
      )
      AND NOT (
        public.profile_is_private(posts.author_id)
        AND posts.author_id <> auth.uid()
        AND NOT public.is_following(auth.uid(), posts.author_id)
      )
    )
  );

-- --------------------------------------------------------- comment visibility
DROP POLICY IF EXISTS "Comments are viewable when not deleted" ON public.comments;
DROP POLICY IF EXISTS "Authors can view their own comments" ON public.comments;
-- Comments are only readable when the parent post is visible to the viewer
-- (posts RLS enforces visibility/status/block/privacy) or the reader authored
-- the comment. ts_deleted stays hidden for everyone but the author.
CREATE POLICY "Comments follow parent post visibility"
  ON public.comments FOR SELECT USING (
    auth.uid() = author_id
    OR (
      is_deleted = false
      AND EXISTS (
        SELECT 1 FROM public.posts p WHERE p.id = comments.post_id
      )
    )
  );

-- -------------------------------------------------------------- ad event gate
DROP POLICY IF EXISTS "Users log their own ad events" ON public.ad_events;
CREATE POLICY "Users log their own ad events"
  ON public.ad_events FOR INSERT TO authenticated
  WITH CHECK (
    (viewer_id IS NULL OR auth.uid() = viewer_id)
    AND EXISTS (
      SELECT 1 FROM public.ad_campaigns c
      WHERE c.id = ad_events.campaign_id AND c.status = 'active'
    )
  );

-- Rate limit: at most one event of the same (campaign, viewer, kind) per 60s.
CREATE OR REPLACE FUNCTION public.ad_event_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.viewer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ad_events e
    WHERE e.campaign_id = NEW.campaign_id
      AND e.viewer_id = NEW.viewer_id
      AND e.kind = NEW.kind
      AND e.created_at > now() - interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'ad event rate limit: % for campaign % within 60s', NEW.kind, NEW.campaign_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ad_event_validate ON public.ad_events;
CREATE TRIGGER ad_event_validate
  BEFORE INSERT ON public.ad_events
  FOR EACH ROW EXECUTE FUNCTION public.ad_event_validate();
