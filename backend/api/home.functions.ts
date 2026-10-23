import { createServerFn } from "@tanstack/react-start";
import { setResponseHeaders } from "@tanstack/react-start/server";
import { cacheStats, invalidate } from "../cache/redisCache";
import {
  EMPTY_PROFILE,
  getFeedPage,
  getHomeFeed,
  type InterestProfile,
} from "../services/feedService";
import { CURRENT_USER_ID } from "../database/seed";
import { optionalSupabaseAuth } from "@/integrations/supabase/optional-auth-middleware";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./admin-auth";
import type { SupabaseClient } from "@supabase/supabase-js";

type HomeAuthContext = {
  supabase: SupabaseClient | null;
  userId: string | null;
};

function homeContext(context: unknown): HomeAuthContext {
  return context as HomeAuthContext;
}

function preventSharedCaching() {
  // setResponseHeaders iterates its argument as [name, value] pairs, so it
  // needs a Headers instance — a plain object throws "headers is not iterable".
  setResponseHeaders(
    new Headers({
      "Cache-Control": "private, no-store",
      Vary: "Authorization",
    }),
  );
}

type HomeInput = { cursor?: string | null; profile?: unknown; scope?: "public" | "viewer" };

function cleanProfile(data: HomeInput | undefined): {
  cursor: string | null;
  profile: InterestProfile;
  scope: "public" | "viewer";
} {
  const raw = (data?.profile ?? {}) as Partial<InterestProfile>;
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
  const watched: InterestProfile["watched"] = {};
  if (raw.watched && typeof raw.watched === "object") {
    for (const [k, v] of Object.entries(raw.watched).slice(0, 100)) {
      const w = v as { plays?: unknown; completed?: unknown } | null;
      if (w && typeof w === "object") {
        watched[k] = {
          plays: typeof w.plays === "number" ? Math.min(Math.max(0, Math.floor(w.plays)), 99) : 0,
          completed: w.completed === true,
        };
      }
    }
  }
  return {
    cursor: data?.cursor ?? null,
    scope: data?.scope === "viewer" ? "viewer" : "public",
    profile: {
      followingIds: strArray(raw.followingIds),
      savedCategories: strArray(raw.savedCategories),
      savedTags: strArray(raw.savedTags),
      mutedAuthorIds: strArray(raw.mutedAuthorIds),
      hiddenPostIds: strArray(raw.hiddenPostIds),
      notInterestedPostIds: strArray(raw.notInterestedPostIds),
      watched,
    },
  };
}

// POST, not GET: the InterestProfile payload (up to ~200 ids × 6 arrays plus
// watch history) would exceed proxy request-line limits as a query string for
// heavy accounts — a silent 431 dead-feed for the most engaged users.
export const fetchHome = createServerFn({ method: "POST" })
  .middleware([optionalSupabaseAuth])
  .validator((data: HomeInput | undefined) =>
    data?.profile !== undefined
      ? cleanProfile(data)
      : { cursor: data?.cursor ?? null, profile: EMPTY_PROFILE, scope: data?.scope ?? "public" },
  )
  .handler(async ({ context, data }) => {
    preventSharedCaching();
    if (data.scope !== "viewer") {
      return getHomeFeed(data.cursor, data.profile, null, undefined);
    }
    const viewer = homeContext(context);
    return getHomeFeed(data.cursor, data.profile, viewer.userId, viewer.supabase);
  });

export const fetchFeedPage = createServerFn({ method: "POST" })
  .middleware([optionalSupabaseAuth])
  .validator((data: HomeInput | undefined) =>
    data?.profile !== undefined
      ? cleanProfile(data)
      : { cursor: data?.cursor ?? null, profile: EMPTY_PROFILE },
  )
  .handler(async ({ context, data }) => {
    preventSharedCaching();
    const viewer = homeContext(context);
    return getFeedPage(
      viewer.userId ?? CURRENT_USER_ID,
      data.cursor,
      data.profile,
      viewer.supabase,
    );
  });

/** Minimum gap between cache busts per user per process — one signed-in user
 * hammering this endpoint must not turn into a constant feed-recompute
 * lever, while independent publishers don't wait on each other. */
const BUST_MIN_INTERVAL_MS = 10_000;
const lastBustByUser = new Map<string, number>();

/**
 * Bust home caches after a publish so new content appears instantly
 * instead of waiting out the 60s TTL. Any signed-in user may bust (the
 * publish/delete flows run as ordinary users, not admins); a per-user
 * cooldown keeps it cheap and stops one account from holding the cache
 * permanently cold. Best-effort — failures resolve true anyway because TTLs
 * still expire stale rows.
 */
export const invalidateHomeCache = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    preventSharedCaching();
    const { userId } = homeContext(context);
    const now = Date.now();
    const key = userId ?? "anonymous";
    if (now - (lastBustByUser.get(key) ?? 0) < BUST_MIN_INTERVAL_MS) {
      return { ok: true as const };
    }
    lastBustByUser.set(key, now);
    // Opportunistic prune so a long-lived process can't grow the map forever.
    if (lastBustByUser.size > 500) {
      for (const [id, at] of lastBustByUser) {
        if (now - at >= BUST_MIN_INTERVAL_MS) lastBustByUser.delete(id);
      }
    }
    await Promise.all([
      invalidate.feedAll(),
      invalidate.candidates(),
      invalidate.stories(),
      invalidate.trending("global"),
    ]).catch(() => undefined);
    return { ok: true as const };
  });

/** Cache backend + hit/miss counters for Admin → System health. */
export const fetchCacheStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    return cacheStats();
  });
