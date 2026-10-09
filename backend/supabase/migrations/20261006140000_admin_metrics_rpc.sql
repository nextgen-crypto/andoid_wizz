-- WIZZ Phase 3: server-side admin metrics aggregation. Re-runnable.
-- One SECURITY DEFINER RPC replaces client-side sampling of 1000 profiles /
-- 2000 follows; gated by is_admin() so it fails closed for non-admins.

CREATE OR REPLACE FUNCTION public.admin_metrics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  out JSON;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT json_build_object(
    'totals', (SELECT json_build_object(
      'users', (SELECT count(*) FROM public.profiles),
      'posts', (SELECT count(*) FROM public.posts),
      'follows', (SELECT count(*) FROM public.follows),
      'today', (SELECT count(*) FROM public.profiles WHERE created_at::date = current_date)
             + (SELECT count(*) FROM public.posts WHERE created_at::date = current_date)
             + (SELECT count(*) FROM public.follows WHERE created_at::date = current_date)
    )),
    'series', (SELECT COALESCE(json_agg(d ORDER BY d.day), '[]'::json) FROM (
      SELECT to_char(day, 'YYYY-MM-DD') AS day,
        (SELECT count(*) FROM public.profiles WHERE created_at::date = day) AS users,
        (SELECT count(*) FROM public.posts WHERE created_at::date = day) AS posts,
        (SELECT count(*) FROM public.follows WHERE created_at::date = day) AS follows
      FROM generate_series(current_date - 13, current_date, interval '1 day') AS day
    ) d),
    'categories', (SELECT COALESCE(json_agg(c ORDER BY c.count DESC), '[]'::json) FROM (
      SELECT category AS name, count(*) AS count
      FROM public.posts
      GROUP BY category
      ORDER BY count DESC
      LIMIT 7
    ) c),
    'hashtags', (SELECT COALESCE(json_agg(t ORDER BY t.count DESC), '[]'::json) FROM (
      SELECT lower(trim(tag)) AS tag, count(*) AS count
      FROM public.posts, LATERAL unnest(hashtags) AS tag
      WHERE trim(tag) <> ''
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 10
    ) t),
    'leaders', (SELECT COALESCE(json_agg(l ORDER BY l.followers DESC), '[]'::json) FROM (
      SELECT p.id, p.username, p.display_name, p.avatar_url, p.verified,
        (SELECT count(*) FROM public.follows f WHERE f.followee_id = p.id) AS followers,
        (SELECT count(*) FROM public.posts po WHERE po.author_id = p.id) AS posts
      FROM public.profiles p
      ORDER BY followers DESC
      LIMIT 8
    ) l),
    'recent', (SELECT COALESCE(json_agg(r ORDER BY r.created_at DESC), '[]'::json) FROM (
      SELECT po.id, po.caption, po.author_id, po.created_at,
        (po.image_url IS NOT NULL OR po.image_path IS NOT NULL) AS has_image
      FROM public.posts po
      ORDER BY po.created_at DESC
      LIMIT 5
    ) r),
    'users', (SELECT COALESCE(json_agg(u ORDER BY u.created_at DESC), '[]'::json) FROM (
      SELECT p.id, p.username, p.display_name, p.avatar_url, p.verified, p.created_at
      FROM public.profiles p
      ORDER BY p.created_at DESC
      LIMIT 200
    ) u),
    'newWeek', (SELECT count(*) FROM public.profiles WHERE created_at >= current_date - 7)
  ) INTO out;

  RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_metrics() TO authenticated;
