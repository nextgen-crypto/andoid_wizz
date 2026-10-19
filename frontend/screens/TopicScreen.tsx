import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronLeft, Hash, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/frontend/components/AppShell";
import { NewsFeedCard, type NewsFeedPost } from "@/frontend/components/news/NewsFeedCard";
import { formatCount } from "@/frontend/components/news/newsFormat";
import { cn } from "@/lib/utils";

export function TopicScreen() {
  const { topic } = useParams({ from: "/topics/$topic" });
  const decoded = decodeURIComponent(topic).replace(/^#/, "");
  const [tab, setTab] = useState<"Top" | "Latest">("Top");

  const topicQuery = useQuery({
    queryKey: ["topic", decoded],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trending_topics")
        .select("id, label, context, post_count")
        .ilike("label", `%${decoded}%`)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; label: string; context: string; post_count: number } | null;
    },
  });

  const postsQuery = useInfiniteQuery({
    queryKey: ["topic-posts", decoded, tab],
    initialPageParam: null as string | null,
    staleTime: 30_000,
    queryFn: async ({ pageParam }) => {
      let query = supabase
        .from("posts")
        .select(
          "id, caption, image_url, video_url, created_at, comments_count, author_id, profiles!inner(id, username, display_name, avatar_url, verified)",
        )
        .eq("status", "published")
        .contains("hashtags", [decoded.toLowerCase()]);
      if (tab === "Top") {
        query = query
          .order("comments_count", { ascending: false })
          .order("created_at", { ascending: false });
      } else {
        query = query.order("created_at", { ascending: false });
        if (pageParam) query = query.lt("created_at", pageParam);
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

  const items = (postsQuery.data?.pages ?? []).flatMap((p) => p.items);

  return (
    <AppShell title={`Topic: ${decoded}`}>
      <div className="mx-auto w-full max-w-2xl">
        <div className="sticky top-14 z-20 flex items-center gap-1 border-b border-border bg-background/95 px-2 py-1.5 backdrop-blur">
          <Link
            to="/explore"
            aria-label="Back"
            className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-secondary"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-sm font-bold text-foreground">
              <Hash className="size-4 text-brand" /> {topicQuery.data?.label ?? decoded}
            </span>
            {topicQuery.data && (
              <span className="block text-xs text-muted-foreground">
                {topicQuery.data.context} · {formatCount(topicQuery.data.post_count)} posts
              </span>
            )}
          </span>
        </div>

        <div className="flex gap-5 border-b border-border">
          {(["Top", "Latest"] as const).map((t) => (
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

        {postsQuery.isLoading ? (
          <div className="space-y-3 px-4 py-4">
            {[0, 1].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-secondary" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-bold text-foreground">No posts for this topic yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Be the first to post with this hashtag.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((post) => (
              <NewsFeedCard key={post.id} post={post} />
            ))}
          </div>
        )}
        <div className="grid h-12 place-items-center">
          {postsQuery.isFetchingNextPage && (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>
    </AppShell>
  );
}

export function TopicPending() {
  return (
    <AppShell title="Topic">
      <div className="mx-auto w-full max-w-2xl space-y-3 px-4 pt-4">
        <div className="h-8 w-3/4 animate-pulse rounded bg-secondary" />
        <div className="h-20 animate-pulse rounded-2xl bg-secondary" />
      </div>
    </AppShell>
  );
}

export function TopicError({ reset }: { reset: () => void }) {
  return (
    <AppShell title="Topic">
      <div className="px-6 py-16 text-center">
        <p className="text-base font-bold">Unable to load topic</p>
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
