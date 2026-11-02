import { queryOptions } from "@tanstack/react-query";
import { fetchCacheStats, fetchFeedPage, fetchHome } from "@/backend/api/home.functions";
import type { InterestProfile } from "@/backend/services/feedService";
import { EMPTY_PROFILE } from "@/backend/services/feedService";

export const homeQueryOptions = queryOptions({
  queryKey: ["home", "feed", "start"],
  queryFn: () => fetchHome({ data: { cursor: null, scope: "public" } }),
  staleTime: 30_000,
  // Transient RPC failures ("Failed to fetch" while the preview reconnects,
  // or the native bridge retrying through CapacitorHttp) should retry instead
  // of blanking the screen. Four attempts with exponential back-off covers
  // most transient network hiccups on native.
  retry: 4,
  retryDelay: (attempt) => Math.min(800 * 2 ** attempt, 6000),
});

function profileHash(p: InterestProfile): string {
  const s = JSON.stringify({
    followingIds: [...p.followingIds].sort(),
    savedCategories: [...p.savedCategories].sort(),
    savedTags: [...p.savedTags].sort(),
    mutedAuthorIds: [...p.mutedAuthorIds].sort(),
    hiddenPostIds: [...p.hiddenPostIds].sort(),
    notInterestedPostIds: [...p.notInterestedPostIds].sort(),
    watched: Object.entries(p.watched)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, value]) => [id, value.plays, value.completed]),
  });
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Personalized first page. The generic SSR page stays as instant fallback. */
export const personalFeedQueryOptions = (
  profile: InterestProfile,
  viewerId: string | null,
  mode: "all" | "following" = "all",
) =>
  queryOptions({
    queryKey: ["home", "feed", "personal", viewerId ?? "anonymous", mode, profileHash(profile)],
    queryFn: () => fetchHome({ data: { cursor: null, profile, scope: "viewer", mode } }),
    staleTime: 30_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(800 * 2 ** attempt, 6000),
  });

export async function loadFeedPage(
  cursor: string | null,
  profile: InterestProfile = EMPTY_PROFILE,
  mode: "all" | "following" = "all",
) {
  return fetchFeedPage({ data: { cursor, profile, mode } });
}

export const cacheStatsQueryOptions = queryOptions({
  queryKey: ["cache-stats"],
  queryFn: () => fetchCacheStats(),
  staleTime: 10_000,
  retry: false,
});
