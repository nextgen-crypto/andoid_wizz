import { supabase } from "@/integrations/supabase/client";

export type FollowCounts = { followers: number; following: number };

function isMissingRpc(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /PGRST202|42883|Could not find the function|does not exist/i.test(msg);
}

/** Follower/following counts for a profile.
 *  Tries the SECURITY DEFINER RPC first; if the migration hasn't been applied
 *  (function missing) it falls back to direct `follows` counts so the profile
 *  never shows a stale 0. */
export async function fetchFollowCounts(userId: string): Promise<FollowCounts> {
  const { data, error } = await supabase.rpc("get_follow_counts", { target_user_id: userId });
  if (!error && data) {
    const counts = data as unknown as Partial<FollowCounts>;
    return { followers: counts.followers ?? 0, following: counts.following ?? 0 };
  }
  // RPC not migrated yet (or failed) → count directly from `follows`.
  if (error && !isMissingRpc(error)) {
    console.warn("[follows] get_follow_counts RPC failed, counting directly:", error.message);
  }

  const [followers, following] = await Promise.all([
    supabase
      .from("follows")
      .select("follower_id", { count: "exact", head: true })
      .eq("followee_id", userId),
    supabase
      .from("follows")
      .select("followee_id", { count: "exact", head: true })
      .eq("follower_id", userId),
  ]);
  return { followers: followers.count ?? 0, following: following.count ?? 0 };
}

type FollowRow = { follower_id: string; followee_id: string };

export type FollowListProfile = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  verified: boolean;
  is_private: boolean;
};

/** Accounts that follow, or are followed by, a profile.
 *  Tries the RPC first, then falls back to a two-step query so lists render
 *  even before the migration runs. */
export async function fetchFollowList(
  profileId: string,
  kind: "followers" | "following",
): Promise<FollowListProfile[]> {
  const { data, error } = await supabase.rpc("get_follow_list", {
    target_user_id: profileId,
    list_kind: kind,
  });
  if (!error && data) return (data ?? []) as FollowListProfile[];
  // RPC not migrated yet → two-step query so lists still render.
  if (error && !isMissingRpc(error)) {
    console.warn("[follows] get_follow_list RPC failed, querying directly:", error.message);
  }

  const column = kind === "followers" ? "follower_id" : "followee_id";
  const filterColumn = kind === "followers" ? "followee_id" : "follower_id";
  const { data: rows, error: rowsError } = await supabase
    .from("follows")
    .select(`${column}`)
    .eq(filterColumn, profileId)
    .limit(200);
  if (rowsError) throw rowsError;
  const ids = [...new Set(((rows ?? []) as FollowRow[]).map((r) => r[column] as string))].filter(
    Boolean,
  );
  if (ids.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, username, display_name, bio, avatar_url, verified, is_private")
    .in("id", ids);
  if (profileError) throw profileError;
  return (profiles ?? []) as FollowListProfile[];
}
