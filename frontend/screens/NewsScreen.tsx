import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { onlineManager, useQuery, useSuspenseQuery, useInfiniteQuery } from "@tanstack/react-query";
import { MoreHorizontal, Loader2, Newspaper } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { creators, explorePhotos } from "@/backend/database/seed";
import { imageUrl } from "@/backend/domain/media";
import { AppShell } from "@/frontend/components/AppShell";
import { StoryListItem } from "@/frontend/components/news/StoryListItem";
import { NewsComposer } from "@/frontend/components/news/NewsComposer";
import { NewsFeedCard, type NewsFeedPost } from "@/frontend/components/news/NewsFeedCard";
import { NewsSidebar } from "@/frontend/components/news/NewsSidebar";
import { formatCount } from "@/frontend/components/news/newsFormat";
import {
  newsStoriesQueryOptions,
  externalNewsQueryOptions,
  type NewsStory,
} from "@/frontend/hooks/useNewsStories";
import { trendingTopicsQueryOptions } from "@/frontend/hooks/useTrendingTopics";
import { useNewsPrefs } from "@/frontend/hooks/useNewsPrefs";
import { useSession } from "@/frontend/hooks/useSession";
import { warmMediaValue } from "@/frontend/lib/offlineStorage";
import { cn } from "@/lib/utils";

const TABS = ["For You", "Following", "Latest"] as const;
const DISCOVER_FILTERS = ["All", "Travel", "Design", "Food", "Sports"] as const;

/** First-time "be the first to post" prompt — remembers a Skip forever per user. */
const FIRST_POST_PROMPT_KEY = "wizz:news-first-post-prompt-dismissed";

/** Screen 1 — Today's News: heading, search, tabs, composer, feed, trending, sidebar. */
export function NewsScreen() {
  const { data } = useSuspenseQuery(newsStoriesQueryOptions);
  const { data: externalStories = [], isPending: isExternalNewsPending } =
    useQuery(externalNewsQueryOptions);

  // Merge internal (DB/seed) stories with external GNews headlines, dedupe by
  // id, and sort newest-first. External news never replaces internal stories —
  // it only augments them, so a missing/failed GNews key leaves the feed intact.
  const stories = useMemo<NewsStory[]>(() => {
    const combined = [...(data?.stories ?? []), ...externalStories];
    const unique = new Map(combined.map((story) => [story.id, story]));

    return [...unique.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [data?.stories, externalStories]);

  const { data: trends = [] } = useSuspenseQuery(trendingTopicsQueryOptions);
  const prefs = useNewsPrefs();
  const { q } = useSearch({ from: "/news" });
  const { user } = useSession();

  const [tab, setTab] = useState<(typeof TABS)[number]>("For You");
  const [hiddenTrends, setHiddenTrends] = useState<string[]>([]);
  const [mutedTrends, setMutedTrends] = useState<string[]>([]);
  const [discover, setDiscover] = useState<(typeof DISCOVER_FILTERS)[number]>("All");
  const [viewing, setViewing] = useState<(typeof explorePhotos)[number] | null>(null);
  const [firstPostPromptDismissed, setFirstPostPromptDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const autoPages = useRef(0);
  useEffect(() => {
    setMounted(true);
    setFirstPostPromptDismissed(localStorage.getItem(FIRST_POST_PROMPT_KEY) === "1");
  }, []);

  // Fetch news posts for For You / Following / Latest tabs
  const postsQuery = useInfiniteQuery({
    queryKey: ["news-feed", tab, user?.id ?? "anonymous", q ?? ""],
    initialPageParam: null as string | null,
    staleTime: 30_000,
    queryFn: async ({ pageParam }) => {
      let query = supabase
        .from("posts")
        .select(
          "id, caption, image_url, video_url, created_at, comments_count, author_id, profiles!inner(id, username, display_name, avatar_url, verified)",
        )
        .eq("status", "published")
        .eq("category", "News");

      if (tab === "Following" && user) {
        const { data: follows } = await supabase
          .from("follows")
          .select("followee_id")
          .eq("follower_id", user.id);
        const ids = (follows ?? []).map((f: { followee_id: string }) => f.followee_id);
        if (ids.length === 0) return { items: [], next: null };
        query = query.in("author_id", ids);
      }

      if (tab === "Latest") {
        query = query.order("created_at", { ascending: false });
        if (pageParam) query = query.lt("created_at", pageParam);
      } else {
        query = query
          .order("comments_count", { ascending: false })
          .order("created_at", { ascending: false });
      }

      const { data, error } = await query.limit(10);
      if (error) throw error;
      const rows = (data ?? []) as unknown as {
        id: string;
        caption: string;
        image_url: string | null;
        video_url: string | null;
        created_at: string;
        comments_count: number;
        author_id: string;
        profiles: {
          id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
          verified: boolean;
        } | null;
      }[];
      const items: NewsFeedPost[] = rows.map((r) => ({
        id: r.id,
        caption: r.caption ?? "",
        imageUrl: r.image_url,
        videoUrl: r.video_url ?? null,
        createdAt: r.created_at,
        commentsCount: r.comments_count ?? 0,
        views: 0,
        author: r.profiles
          ? {
              id: r.profiles.id,
              username: r.profiles.username ?? "?",
              displayName: r.profiles.display_name ?? "?",
              avatarUrl: r.profiles.avatar_url,
              verified: r.profiles.verified === true,
            }
          : null,
      }));
      return { items, next: items.length === 10 ? items[items.length - 1]!.createdAt : null };
    },
    getNextPageParam: (last) => last.next,
  });

  useEffect(() => {
    autoPages.current = 0;
  }, [tab, user?.id, q]);

  // Download two extra pages quietly, and warm their photos for offline use.
  useEffect(() => {
    if (
      !onlineManager.isOnline() ||
      !postsQuery.hasNextPage ||
      postsQuery.isFetchingNextPage ||
      autoPages.current >= 2
    ) {
      return;
    }
    autoPages.current += 1;
    void postsQuery.fetchNextPage();
  }, [
    postsQuery.hasNextPage,
    postsQuery.isFetchingNextPage,
    postsQuery.fetchNextPage,
    tab,
    user?.id,
    q,
  ]);

  useEffect(() => {
    if (postsQuery.data) warmMediaValue(postsQuery.data.pages);
  }, [postsQuery.data]);

  const feedPosts = (postsQuery.data?.pages ?? []).flatMap((p) => p.items);

  const feed = useMemo(() => {
    const needle = (q ?? "").trim().toLowerCase();
    let list = [...stories];
    if (!mounted) {
      return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    if (needle) {
      const words = needle.split(/\s+/);
      return list
        .map((s) => {
          const hay = `${s.headline} ${s.summary} ${s.category}`.toLowerCase();
          return { s, hits: words.filter((w) => hay.includes(w)).length };
        })
        .filter((x) => x.hits > 0)
        .sort((a, b) => b.hits - a.hits || b.s.postCount - a.s.postCount)
        .map((x) => x.s);
    }
    if (tab === "Following") {
      const followed = [
        ...prefs.topics,
        ...prefs.sources,
        ...loadIds("wizz:news-stories-followed"),
      ];
      list = list.filter(
        (s) =>
          followed.includes(s.id) ||
          followed.includes(s.category.toLowerCase()) ||
          followed.includes(s.headline.toLowerCase()),
      );
    }
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [stories, tab, q, prefs, mounted]);

  const visibleTrends = trends.filter(
    (t) => !hiddenTrends.includes(t.id) && !mutedTrends.includes(t.id),
  );

  const byId = useMemo(() => new Map(creators.map((c) => [c.id, c])), []);
  const photos = useMemo(
    () =>
      discover === "All" ? explorePhotos : explorePhotos.filter((p) => p.category === discover),
    [discover],
  );

  return (
    <AppShell title="News">
      <div className="mx-auto flex w-full max-w-5xl">
        <div className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-2xl">
            <div className="px-4 pt-3">
              <div className="mt-1 flex gap-5 border-b border-border">
                {TABS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    aria-pressed={tab === t}
                    className={cn(
                      "relative py-2.5 text-sm",
                      tab === t ? "font-bold text-foreground" : "font-medium text-muted-foreground",
                    )}
                  >
                    {t}
                    {tab === t && (
                      <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {tab === "For You" && (
              <NewsComposer
                onPosted={() => {
                  // Refresh the news feed so the new post appears immediately
                  // instead of waiting out the staleTime.
                  void postsQuery.refetch();
                }}
              />
            )}

            {/* Live news posts feed — shown on every tab */}
            {postsQuery.isLoading ? (
              <div className="space-y-3 px-4 py-4">
                {[0, 1].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-2xl bg-secondary" />
                ))}
              </div>
            ) : feedPosts.length === 0 ? (
              <FirstPostPrompt
                skipped={firstPostPromptDismissed}
                followingTab={tab === "Following"}
                onSkip={() => {
                  try {
                    localStorage.setItem(FIRST_POST_PROMPT_KEY, "1");
                  } catch {
                    /* private mode — skip still hides for this session */
                  }
                  setFirstPostPromptDismissed(true);
                }}
              />
            ) : (
              <div className="divide-y divide-border">
                {feedPosts.map((post) => (
                  <NewsFeedCard key={post.id} post={post} />
                ))}
              </div>
            )}
            <div className="grid h-12 place-items-center">
              {postsQuery.isFetchingNextPage && (
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              )}
              {!postsQuery.isFetchingNextPage && !postsQuery.isLoading && feedPosts.length > 0 && (
                <button
                  onClick={() => void postsQuery.fetchNextPage()}
                  disabled={!postsQuery.hasNextPage}
                  className="rounded-full border border-border px-5 py-2 text-sm font-bold text-foreground disabled:opacity-40"
                >
                  {postsQuery.hasNextPage ? "Load more" : "You're all caught up"}
                </button>
              )}
            </div>

            {/* Stories list for For You tab */}
            {tab === "For You" && (
              <>
                {feed.length === 0 ? (
                  <EmptyState
                    title="No stories found"
                    body="Try different words or check back later."
                  />
                ) : (
                  <div className="divide-y divide-border">
                    {feed.map((s) => (
                      <StoryListItem key={s.id} story={s} />
                    ))}
                    {isExternalNewsPending && (
                      <div className="flex items-center justify-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        Loading external headlines…
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {visibleTrends.length > 0 && (
              <section className="mt-2 border-t border-border pt-1" aria-label="Trending">
                <h2 className="px-4 pb-1 pt-3 text-sm font-extrabold text-foreground">Trending</h2>
                <div className="divide-y divide-border">
                  {visibleTrends.map((t) => (
                    <TrendRow
                      key={t.id}
                      label={t.label}
                      context={t.context || "Trending"}
                      count={t.postCount}
                      followed={prefs.topics.includes(t.label.replace(/^#/, "").toLowerCase())}
                      onFollow={() => prefs.toggleTopic(t.label)}
                      onHide={() => setHiddenTrends((prev) => [...prev, t.id])}
                      onMute={() => setMutedTrends((prev) => [...prev, t.id])}
                    />
                  ))}
                </div>
              </section>
            )}

            <section className="mt-2 border-t border-border pt-1" aria-label="Discover">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4">
                <h2 className="pb-1 pt-3 text-sm font-extrabold text-foreground">Discover</h2>
                <div className="flex min-w-0 justify-end gap-3 overflow-x-auto no-scrollbar">
                  {DISCOVER_FILTERS.map((f) => (
                    <button
                      key={f}
                      onClick={() => setDiscover(f)}
                      className={cn(
                        "shrink-0 text-sm font-semibold",
                        discover === f ? "text-brand" : "text-muted-foreground",
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 grid auto-rows-[110px] grid-cols-2 gap-1 px-1 sm:auto-rows-[140px] sm:grid-cols-3">
                {photos.map((p, index) => (
                  <figure
                    key={p.id}
                    className={cn(
                      "overflow-hidden rounded-sm",
                      index % 7 === 0 && "row-span-2",
                      index % 7 === 3 && "col-span-2 row-span-2 sm:col-span-1",
                      index % 7 === 5 && "sm:col-span-2",
                    )}
                  >
                    <button
                      onClick={() => setViewing(p)}
                      aria-label={`Open ${p.category} photo full screen`}
                      className="block h-full w-full"
                    >
                      <img
                        src={imageUrl(p.key, "medium", p.aspect)}
                        alt={`${p.category} photo by ${byId.get(p.authorId)?.displayName ?? "WIZZ creator"}`}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-200 hover:scale-[1.03]"
                      />
                    </button>
                  </figure>
                ))}
              </div>
            </section>
            <div className="h-24" aria-hidden="true" />
          </div>
        </div>

        <NewsSidebar />
      </div>

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
          role="dialog"
          aria-label="Photo viewer"
          onClick={() => setViewing(null)}
        >
          <div className="flex items-center justify-between px-4 pt-safe">
            <p className="truncate text-sm font-semibold text-white">
              {viewing.category} · by {byId.get(viewing.authorId)?.displayName ?? "WIZZ creator"}
            </p>
            <button
              aria-label="Close viewer"
              onClick={() => setViewing(null)}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-xl font-bold text-white"
            >
              ×
            </button>
          </div>
          <div className="grid min-h-0 flex-1 place-items-center p-4">
            <img
              src={imageUrl(viewing.key, "large", viewing.aspect)}
              alt={`${viewing.category} photo full screen`}
              className="animate-scale-in max-h-full max-w-full rounded-2xl object-contain"
            />
          </div>
        </div>
      )}
    </AppShell>
  );
}

function loadIds(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function TrendRow({
  label,
  context,
  count,
  followed,
  onFollow,
  onHide,
  onMute,
}: {
  label: string;
  context: string;
  count: number;
  followed: boolean;
  onFollow: () => void;
  onHide: () => void;
  onMute: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex items-center gap-2 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <Link
          to="/topics/$topic"
          params={{ topic: label.replace(/^#/, "").toLowerCase() }}
          className="block"
        >
          <p className="truncate text-sm font-semibold text-foreground hover:underline">{label}</p>
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {context}
          {count > 0 ? ` · ${formatCount(count)} posts` : ""}
          {followed ? " · Following" : ""}
        </p>
      </div>
      <span className="relative shrink-0">
        <button
          aria-label={`Options for ${label}`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded-full p-1.5 hover:bg-secondary"
        >
          <MoreHorizontal className="size-4 text-muted-foreground" />
        </button>
        {menuOpen && (
          <>
            <button
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div className="absolute right-0 top-8 z-20 w-44 overflow-hidden rounded-2xl border border-border bg-card shadow-raise">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onFollow();
                }}
                className="block w-full px-3 py-2.5 text-left text-sm font-medium hover:bg-secondary"
              >
                {followed ? "Unfollow topic" : "Follow topic"}
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onHide();
                }}
                className="block w-full px-3 py-2.5 text-left text-sm font-medium hover:bg-secondary"
              >
                Not interested
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onMute();
                }}
                className="block w-full px-3 py-2.5 text-left text-sm font-medium hover:bg-secondary"
              >
                Mute this trend
              </button>
            </div>
          </>
        )}
      </span>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-sm font-bold text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-72 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

/** First-time prompt nudging a new user to write the first news post.
 *  A Skip hides it for good (localStorage) — the plain empty state shows after. */
function FirstPostPrompt({
  skipped,
  followingTab,
  onSkip,
}: {
  skipped: boolean;
  followingTab: boolean;
  onSkip: () => void;
}) {
  if (skipped) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm font-bold text-foreground">No posts yet</p>
        <p className="mx-auto mt-1 max-w-72 text-xs leading-relaxed text-muted-foreground">
          {followingTab
            ? "Follow news publishers to see their posts here."
            : "Be the first to post about the news."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-4 my-3 rounded-3xl border border-border bg-card p-5 text-center shadow-raise">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-brand/10 text-brand">
        <Newspaper className="size-6" />
      </span>
      <p className="mt-3 text-base font-black text-foreground">No posts yet</p>
      <p className="mx-auto mt-1 max-w-72 text-sm leading-relaxed text-muted-foreground">
        Be the first to post about the news and get the conversation started.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <button
          onClick={() =>
            window.dispatchEvent(new CustomEvent("open-create", { detail: { kind: "text" } }))
          }
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-brand-foreground press"
        >
          Write a post
        </button>
        <button
          onClick={onSkip}
          className="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-muted-foreground hover:bg-secondary"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

export function NewsPending() {
  return (
    <AppShell title="News">
      <div className="mx-auto w-full max-w-2xl space-y-3 px-4 pt-4">
        <div className="h-7 w-40 animate-pulse rounded bg-secondary" />
        <div className="h-10 w-full animate-pulse rounded-full bg-secondary" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 py-2">
            <div className="h-4 w-11/12 animate-pulse rounded bg-secondary" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-secondary" />
          </div>
        ))}
      </div>
    </AppShell>
  );
}

export function NewsError({ reset }: { reset: () => void }) {
  return (
    <AppShell title="News">
      <div className="px-6 py-16 text-center">
        <p className="text-base font-bold">Unable to load news</p>
        <p className="mt-1 text-sm text-muted-foreground">Something went wrong. Try again.</p>
        <button
          onClick={reset}
          className="mt-4 rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-brand-foreground"
        >
          Retry
        </button>
      </div>
    </AppShell>
  );
}
