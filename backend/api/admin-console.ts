import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./admin-auth";

/**
 * Console data that must be computed server-side with the service role:
 *
 *  - follower/post counts can't be aggregated in the browser (RLS hides rows
 *    on private profiles, and PostgREST has no GROUP BY over two tables), so
 *    the Creators panel previously rendered whatever the metrics RPC happened
 *    to return — or nothing at all.
 *  - hiding content needs to write to a row the admin doesn't own, which the
 *    posts UPDATE policy (author only) will always reject.
 *
 * Every function is gated by requireAdmin and degrades to `live:false` so the
 * UI can fall back instead of showing a dead panel.
 */

async function adminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const MAX_ROWS = 5000;

export interface AdminCreator {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  verified: boolean;
  followers: number;
  posts: number;
}

/** Real creator leaderboard: profiles joined with true follower/post counts. */
export const fetchAdminCreators = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ creators: AdminCreator[]; live: boolean }> => {
    await requireAdmin(context);
    try {
      const db = await adminDb();
      const [profilesRes, followsRes, postsRes] = await Promise.all([
        db
          .from("profiles")
          .select("id, username, display_name, avatar_url, verified")
          .order("created_at", { ascending: false })
          .limit(500),
        db
          .from("follows")
          .select("follower_id, followee_id")
          .limit(MAX_ROWS),
        db.from("posts").select("author_id, status").limit(MAX_ROWS),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      if (followsRes.error) throw followsRes.error;
      if (postsRes.error) throw postsRes.error;

      const followers = new Map<string, number>();
      for (const f of (followsRes.data ?? []) as { followee_id: string }[]) {
        followers.set(f.followee_id, (followers.get(f.followee_id) ?? 0) + 1);
      }
      const posts = new Map<string, number>();
      for (const p of (postsRes.data ?? []) as { author_id: string; status: string }[]) {
        if (p.status === "deleted") continue;
        posts.set(p.author_id, (posts.get(p.author_id) ?? 0) + 1);
      }

      const creators: AdminCreator[] = ((profilesRes.data ?? []) as AdminCreator[])
        .map((p) => ({
          id: p.id,
          username: p.username,
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          verified: p.verified,
          followers: followers.get(p.id) ?? 0,
          posts: posts.get(p.id) ?? 0,
        }))
        .sort((a, b) => b.followers - a.followers || b.posts - a.posts)
        .slice(0, 50);
      return { creators, live: true };
    } catch {
      return { creators: [], live: false };
    }
  });

export type AdminPostStatus = "published" | "archived" | "deleted";

const ALLOWED_STATUS: AdminPostStatus[] = ["published", "archived", "deleted"];

/** Actually hide/restore content. `archived` keeps the row for moderation
 *  history and drops it out of every feed query. */
export const adminSetPostStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (data: { id?: string; status?: AdminPostStatus } | undefined) => ({
      id: data?.id ?? "",
      status: (data?.status ?? "archived") as AdminPostStatus,
    }),
  )
  .handler(async ({ context, data }): Promise<{ ok: boolean; status: AdminPostStatus }> => {
    await requireAdmin(context);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id)) {
      throw new Error("Post not found.");
    }
    if (!ALLOWED_STATUS.includes(data.status)) throw new Error("Unknown status.");
    const db = await adminDb();
    const { error } = await db.from("posts").update({ status: data.status }).eq("id", data.id);
    if (error) throw error;
    return { ok: true, status: data.status };
  });
