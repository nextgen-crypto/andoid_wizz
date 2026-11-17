import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type TouchEvent,
} from "react";
import { onlineManager, useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { fetchFeedPage } from "@/backend/api/home.functions";
import type { FeedItem } from "@/backend/services/feedService";
import { homeQueryOptions, personalFeedQueryOptions } from "@/frontend/queries/home";
import { TopBar } from "@/frontend/components/home/TopBar";
import { StoryRail } from "@/frontend/components/home/StoryRail";
import { FeedCard } from "@/frontend/components/home/FeedCard";
import { FeedSkeleton } from "@/frontend/components/home/FeedSkeleton";
import { BottomNav } from "@/frontend/components/home/BottomNav";
import { useAds } from "@/frontend/components/ads/ads";
import { SponsoredCard } from "@/frontend/components/ads/SponsoredCard";
import { SponsoredPostCard, usePromotions } from "@/frontend/components/ads/SponsoredPostCard";
import { useShowcase } from "@/frontend/components/showcase/showcase";
import { ShowcaseCarousel } from "@/frontend/components/showcase/ShowcaseCarousel";
import { useSession } from "@/frontend/hooks/useSession";
import { useMyProfile } from "@/frontend/hooks/useMyProfile";
import { useSavedPosts } from "@/frontend/hooks/useSavedPosts";
import { useFollowList } from "@/frontend/hooks/usePublicProfile";
import { buildInterestProfile, useFeedPrefs } from "@/frontend/hooks/useFeedPrefs";
import { useEventTracker } from "@/frontend/hooks/useEventTracker";
import { loadFeedSnapshot, saveFeedSnapshot, type FeedSnapshot } from "@/frontend/lib/feedSnapshot";
import { warmMediaValue } from "@/frontend/lib/offlineStorage";
import { cn } from "@/frontend/lib/utils";
import { toast } from "sonner";

type FeedMode = "all" | "following";

export function HomeScreen() {
  const { data: base } = useSuspenseQuery(homeQueryOptions);
  const loadPage = useServerFn(fetchFeedPage);
  const online = useSyncExternalStore(
    (onStoreChange) => onlineManager.subscribe(onStoreChange),
    () => onlineManager.isOnline(),
    () => true,
  );

  const { user, loading: sessionLoading } = useSession();
  const userId = user?.id ?? null;
  const { data: myProfile } = useMyProfile(userId);
  const { data: savedPosts = [] } = useSavedPosts(userId);
  const { data: following = [] } = useFollowList(myProfile?.id ?? null, "following", userId);
  const prefs = useFeedPrefs(userId);
  const { track } = useEventTracker(userId);

  // Viewer taste: follows + saves + mutes + hides + watch history.
  // Cold start: onboarding picks count as saved categories until real signals arrive.
  const profile = useMemo(() => {
    let onboard: string[] = [];
    try {
      const raw = JSON.parse(localStorage.getItem("wizz:onboard-interests") ?? "{}") as {
        categories?: unknown;
      };
      if (Array.isArray(raw.categories)) {
        onboard = raw.categories.filter((c): c is string => typeof c === "string");
      }
    } catch {
      // ignore
    }
    const built = buildInterestProfile({
      followingIds: following.map((f) => f.id),
      savedPosts,
      muted: prefs.muted,
      hidden: prefs.hidden,
      notInterested: prefs.notInterested,
      watched: prefs.watched,
    });
    return {
      ...built,
      savedCategories: [
        ...new Set([...built.savedCategories, ...onboard.map((c) => c.toLowerCase())]),
      ],
    };
  }, [following, savedPosts, prefs.muted, prefs.hidden, prefs.notInterested, prefs.watched]);

  const [mounted, setMounted] = useState(false);

  // ---- Feed state (declared before mode/refresh callbacks that mutate it) ----
  const [storyRail, setStoryRail] = useState(base.stories);
  const [storyViewerId, setStoryViewerId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<FeedSnapshot | null>(null);
  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  const [feedViewerId, setFeedViewerId] = useState<string | null>(null);
  /** Which tab the current `feed` pages belong to — guards cross-tab bleed. */
  const [feedMode, setFeedMode] = useState<FeedMode | null>(null);
  const [extra, setExtra] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(base.feed.nextCursor);
  const [hasMore, setHasMore] = useState(base.feed.hasMore);
  const [loading, setLoading] = useState(false);
  /** "page" = infinite-scroll failure; "refresh" = pull-to-refresh failure. */
  const [feedError, setFeedError] = useState<"page" | "refresh" | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const feedRequestVersion = useRef(0);
  const snapshotLoaded = useRef(false);
  const autoPages = useRef(0);

  const mode: FeedMode = "all";
  useEffect(() => {
    setMounted(true);
  }, []);

  // Personalized first page replaces the generic SSR page once ready. Story
  // state is separate because the viewer-specific query also refreshes it.
  const {
    data: personal,
    isPending: personalPending,
    isError: personalError,
    refetch: refetchPersonal,
  } = useQuery({
    ...personalFeedQueryOptions(profile, userId, mode),
    enabled: mounted && !sessionLoading,
  });

  useEffect(() => {
    feedRequestVersion.current += 1;
    snapshotLoaded.current = false;
    autoPages.current = 0;
    setSnapshot(null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!personal) return;
    feedRequestVersion.current += 1;
    setStoryRail(personal.stories);
    setStoryViewerId(userId);
    setFeed(personal.feed.items);
    setFeedViewerId(userId);
    setFeedMode(mode);
    setCursor(personal.feed.nextCursor);
    setHasMore(personal.feed.hasMore);
    setExtra([]);
    setFeedError(null);
    warmMediaValue(personal.feed.items);
  }, [personal, mode, userId]);

  // Cold offline start: the persisted query cache only has the first page, so
  // restore the multi-page snapshot saved on an earlier online visit. While
  // offline this snapshot wins over the one-page cached personal query.
  useEffect(() => {
    if (!mounted || sessionLoading || snapshotLoaded.current) return;
    snapshotLoaded.current = true;
    let cancelled = false;
    void loadFeedSnapshot(userId, mode).then((saved) => {
      if (cancelled || !saved || saved.items.length === 0) return;
      setSnapshot(saved);
      warmMediaValue(saved.items);
    });
    return () => {
      cancelled = true;
    };
  }, [mounted, sessionLoading, userId, mode]);

  // ---- Pull-to-refresh: refetch the personalized page (stories ride along)
  // without resetting the base suspense query, which would suspend the screen. ----
  const [refreshing, setRefreshing] = useState(false);
  const [pullDist, setPullDist] = useState(0);
  const pullStart = useRef<number | null>(null);
  const refreshingRef = useRef(false);

  const refreshFeed = useCallback(async () => {
    if (refreshingRef.current || !online) return;
    refreshingRef.current = true;
    autoPages.current = 0;
    setRefreshing(true);
    setFeedError(null);
    try {
      const result = await refetchPersonal();
      if (result.error) {
        setFeedError("refresh");
      } else {
        window.scrollTo({ top: 0 });
      }
    } catch {
      setFeedError("refresh");
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
      setPullDist(0);
      pullStart.current = null;
    }
  }, [online, refetchPersonal]);

  const onPullStart = (e: TouchEvent) => {
    if (refreshingRef.current || window.scrollY > 0) return;
    pullStart.current = e.touches[0]?.clientY ?? null;
  };
  const onPullMove = (e: TouchEvent) => {
    if (pullStart.current == null || refreshingRef.current) return;
    const dy = (e.touches[0]?.clientY ?? 0) - pullStart.current;
    if (dy <= 0) {
      setPullDist(0);
      return;
    }
    // Resistance so the indicator follows the finger without yanking the page.
    setPullDist(Math.min(dy * 0.4, 72));
  };
  const onPullEnd = () => {
    if (pullStart.current == null) return;
    const shouldRefresh = pullDist >= 48;
    pullStart.current = null;
    setPullDist(0);
    if (shouldRefresh) void refreshFeed();
  };

  const loadMore = useCallback(async () => {
    if (!online || feedViewerId !== userId || feedMode !== mode) return;
    if (loading || !hasMore || !cursor) return;
    const requestVersion = ++feedRequestVersion.current;
    setLoading(true);
    setFeedError(null);
    try {
      const page = await loadPage({ data: { cursor, profile, mode } });
      if (requestVersion !== feedRequestVersion.current || feedViewerId !== userId) return;
      warmMediaValue(page.items);
      // Keyset pages can repeat an id at lane boundaries — drop duplicates so
      // pagination never renders the same post twice.
      setExtra((prev) => {
        const seen = new Set(prev.map((i) => i.post.id));
        return [...prev, ...page.items.filter((i) => !seen.has(i.post.id))];
      });
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      if (requestVersion === feedRequestVersion.current) {
        // Keep hasMore true so the retry button can resume from the same cursor.
        setFeedError("page");
      }
    } finally {
      if (requestVersion === feedRequestVersion.current) setLoading(false);
    }
  }, [cursor, feedMode, feedViewerId, hasMore, loading, loadPage, mode, online, profile, userId]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [loadMore]);

  function removePost(postId: string) {
    setFeed((prev) => (prev ? prev.filter((i) => i.post.id !== postId) : prev));
    setExtra((prev) => prev.filter((i) => i.post.id !== postId));
    setSnapshot((prev) =>
      prev ? { ...prev, items: prev.items.filter((i) => i.post.id !== postId) } : prev,
    );
  }

  function removeAuthor(authorId: string) {
    setFeed((prev) => (prev ? prev.filter((i) => i.author.id !== authorId) : prev));
    setExtra((prev) => prev.filter((i) => i.author.id !== authorId));
    setSnapshot((prev) =>
      prev ? { ...prev, items: prev.items.filter((i) => i.author.id !== authorId) } : prev,
    );
  }

  // Data for the selected tab: personalized pages when they match the tab,
  // otherwise the instant SSR fallback — but only for "all" (the SSR page is a
  // mixed feed, never a valid Following result).
  const offlineSnapshot =
    !online && snapshot !== null && snapshot.items.length > 0 ? snapshot : null;
  const feedMatchesTab = offlineSnapshot !== null || (feedViewerId === userId && feedMode === mode);

  // Keep the offline snapshot in sync with whatever has actually been loaded.
  useEffect(() => {
    if (offlineSnapshot || !feedMatchesTab || feed === null || feed.length === 0) return;
    void saveFeedSnapshot({
      viewerId: userId,
      mode,
      items: [...feed, ...extra],
      cursor,
      hasMore,
    });
  }, [offlineSnapshot, feed, extra, cursor, hasMore, feedMatchesTab, userId, mode]);

  // Quietly download a couple more pages so the next cold start can scroll
  // without a connection. The user never sees an offline/sync notice.
  useEffect(() => {
    if (!online || !feedMatchesTab || loading || feedError || !hasMore || !cursor) {
      return;
    }
    if (autoPages.current >= 2) return;
    autoPages.current += 1;
    void loadMore();
  }, [online, feedMatchesTab, loading, feedError, hasMore, cursor, loadMore]);

  const paged = offlineSnapshot ? offlineSnapshot.items : feed !== null ? [...feed, ...extra] : [];
  const items: FeedItem[] = feedMatchesTab ? paged : mode === "all" ? base.feed.items : [];
  const activeHasMore = offlineSnapshot ? offlineSnapshot.hasMore : hasMore;
  const showSkeleton = !feedMatchesTab && personalPending && items.length === 0;

  const visibleStoryRail = storyViewerId === userId ? storyRail : base.stories;
  const ads = useAds();
  const slides = useShowcase();
  const { data: promotions = [] } = usePromotions(userId);
  const [hiddenPromos, setHiddenPromos] = useState<string[]>([]);
  const livePromos = promotions.filter((p) => !hiddenPromos.includes(p.campaignId));

  const followingEmpty = false;
  const followingError = false;

  return (
    <div
      className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col bg-background md:border-x md:border-border"
      onTouchStart={onPullStart}
      onTouchMove={onPullMove}
      onTouchEnd={onPullEnd}
    >
      <TopBar />
      <main className="min-w-0 flex-1 pb-24 sm:pb-28">
        <h1 className="sr-only">WIZZ home feed</h1>

        {/* Pull-to-refresh indicator — expands with the drag distance. */}
        <div
          aria-hidden="true"
          className="flex items-center justify-center overflow-hidden transition-[height] duration-200"
          style={{ height: refreshing ? 44 : pullDist }}
        >
          {(refreshing || pullDist > 8) && (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          )}
        </div>

        {feedError === "refresh" && (
          <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/50 px-4 py-2.5">
            <p className="text-xs text-muted-foreground">Couldn&apos;t refresh the feed.</p>
            <button
              onClick={() => {
                setFeedError(null);
                void refreshFeed();
              }}
              className="text-xs font-semibold text-foreground underline-offset-2 hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        <StoryRail
          currentUser={base.currentUser}
          currentUserAvatar={myProfile?.avatar_url}
          currentUserUsername={myProfile?.username}
          stories={visibleStoryRail}
        />
        {slides.length > 0 && <ShowcaseCarousel slides={slides} />}

        {showSkeleton && <FeedSkeleton />}

        {followingError && (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-semibold text-foreground">Couldn&apos;t load this feed</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Check your connection and try again.
            </p>
            <button
              onClick={() => void refetchPersonal()}
              className="mt-4 rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              Retry
            </button>
          </div>
        )}

        {followingEmpty && (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-semibold text-foreground">
              No posts from people you follow yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              When you follow creators, their posts show up here.
            </p>
            <button
              onClick={() => void refreshFeed()}
              className="mt-4 rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              Refresh
            </button>
          </div>
        )}

        {!showSkeleton && items.length === 0 && mode === "all" && (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-semibold text-foreground">No posts yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Be the first to share something on WIZZ.
            </p>
          </div>
        )}

        {items.map((item, i) => (
          <div key={item.post.id}>
            <FeedCard
              item={item}
              index={i}
              track={track}
              onWatch={(postId, completed) => prefs.recordWatch(postId, completed)}
              onHidePost={(postId) => {
                prefs.hidePost(postId);
                track("hide", postId, { authorId: item.author.id });
                removePost(postId);
              }}
              onNotInterested={(postId) => {
                prefs.markNotInterested(postId);
                track("not_interested", postId, { authorId: item.author.id });
              }}
              onMuteAuthor={(authorId, username) => {
                prefs.muteAuthor(authorId, username);
                track("creator_mute", item.post.id, { authorId });
                removeAuthor(authorId);
                toast(`Muted @${username}`, {
                  action: { label: "Undo", onClick: () => prefs.unmuteAuthor(authorId) },
                });
              }}
            />
            {livePromos.length > 0 && i % 5 === 4
              ? (() => {
                  const promo = livePromos[Math.floor(i / 5) % livePromos.length]!;
                  return (
                    <SponsoredPostCard
                      promo={promo}
                      viewerId={userId}
                      onHide={(campaignId) => setHiddenPromos((prev) => [...prev, campaignId])}
                      onMuteAuthor={(authorId, username) => {
                        prefs.muteAuthor(authorId, username);
                        track("creator_mute", promo.post.id, { authorId });
                        removeAuthor(authorId);
                        setHiddenPromos((prev) => [...prev, promo.campaignId]);
                        toast(`Muted @${username}`, {
                          action: { label: "Undo", onClick: () => prefs.unmuteAuthor(authorId) },
                        });
                      }}
                    />
                  );
                })()
              : ads.length > 0 &&
                livePromos.length === 0 &&
                i % 4 === 3 && <SponsoredCard ad={ads[Math.floor(i / 4) % ads.length]!} />}
          </div>
        ))}

        <div ref={sentinel} className="grid h-16 place-items-center">
          {loading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
          {feedError === "page" && !loading && (
            <button
              onClick={() => void loadMore()}
              className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              Couldn&apos;t load more — Retry
            </button>
          )}
          {!activeHasMore && !loading && !feedError && items.length > 0 && (
            <p className="text-xs text-muted-foreground">You&apos;re all caught up</p>
          )}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
