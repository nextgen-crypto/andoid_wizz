-- Fix 1: Follows RLS policy — allow users to see their own follow relationships
-- The old policy hid follow rows when either party was private and the viewer
-- didn't follow them. This broke own-profile follower counts and follow lists.
-- New policy: users always see follow rows where they are follower OR followee.
-- Third parties only see public follow relationships.

DROP POLICY IF EXISTS "Follows respect privacy" ON public.follows;
CREATE POLICY "Follows respect privacy"
  ON public.follows FOR SELECT USING (
    -- Users can always see their own follow relationships
    auth.uid() = follower_id
    OR auth.uid() = followee_id
    -- Public follow relationships are visible to everyone
    OR NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id IN (follows.follower_id, follows.followee_id)
        AND p.is_private
    )
    -- Private account's follow relationships are visible to their followers
    OR (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id IN (follows.follower_id, follows.followee_id)
          AND p.is_private
      )
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = follows.follower_id
            AND p.is_private
            AND public.is_following(auth.uid(), p.id)
        )
        OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = follows.followee_id
            AND p.is_private
            AND public.is_following(auth.uid(), p.id)
        )
      )
    )
  );

-- Fix 2: Admin metrics — make is_admin() also check email allowlist
-- The frontend uses VITE_ADMIN_EMAILS for admin check, but the backend RPC
-- uses is_admin() which only checks admin_roles table. This migration makes
-- is_admin() also check the email allowlist from auth.users.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
      AND lower(email) = ANY (
        SELECT lower(trim(unnest(string_to_array(
          current_setting('app.admin_emails', true), ','
        ))))
      )
  );
$$;

-- Also update admin_metrics RPC to use the same email-based check
-- The RPC already calls is_admin(), so the fix above is sufficient.

-- Insert admin users from env into admin_roles if they exist
-- This ensures the admin_roles table is populated for existing admins
INSERT INTO public.admin_roles (user_id, email)
SELECT u.id, u.email
FROM auth.users u
WHERE lower(u.email) = ANY (
  SELECT lower(trim(unnest(string_to_array(
    current_setting('app.admin_emails', true), ','
  ))))
)
ON CONFLICT (user_id) DO NOTHING;
