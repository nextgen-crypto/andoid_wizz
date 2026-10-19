import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, TrendingUp, Users, Film, Newspaper, Hash } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/frontend/components/AppShell";
import { trendingTopicsQueryOptions } from "@/frontend/hooks/useTrendingTopics";
import { useSuspenseQuery } from "@tanstack/react-query";
import { formatCount } from "@/frontend/components/news/newsFormat";
import { cn } from "@/lib/utils";

type SearchTab = "Top" | "Latest" | "People" | "Media" | "News" | "Topics";

const SEARCH_TABS: { id: SearchTab; label: string; Icon: typeof Users }[] = [
  { id: "Top", label: "Top", Icon: TrendingUp },
  { id: "Latest", label: "Latest", Icon: Search },
  { id: "People", label: "People", Icon: Users },
  { id: "Media", label: "Media", Icon: Film },
  { id: "News", label: "News", Icon: Newspaper },
  { id: "Topics", label: "Topics", Icon: Hash },
];

export function ExploreScreen() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("Top");
  const { data: trends = [] } = useSuspenseQuery(trendingTopicsQueryOptions);

  const searchQuery = useQuery({
    queryKey: ["explore-search", query, tab],
    enabled: query.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const q = query.trim();
      if (tab === "People") {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url, verified, bio")
          .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
          .limit(20);
        if (error) throw error;
        return { type: "people" as const, results: data ?? [] };
      }
      if (tab === "Media") {
        const { data, error } = await supabase
          .from("posts")
          .select("id, caption, image_url, created_at, author_id")
          .eq("status", "published")
          .or(`caption.ilike.%${q}%`)
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) throw error;
        return { type: "media" as const, results: data ?? [] };
      }
      if (tab === "Topics") {
        const { data, error } = await supabase
          .from("trending_topics")
          .select("id, label, context, post_count")
          .ilike("label", `%${q}%`)
          .limit(20);
        if (error) throw error;
        return { type: "topics" as const, results: data ?? [] };
      }
      const { data, error } = await supabase
        .from("posts")
        .select("id, caption, image_url, created_at, author_id")
        .eq("status", "published")
        .or(`caption.ilike.%${q}%`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return { type: "posts" as const, results: data ?? [] };
    },
  });

  return (
    <AppShell title="Explore">
      <div className="mx-auto w-full max-w-2xl">
        <div className="sticky top-14 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2 rounded-full bg-secondary px-3.5 py-2.5">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search WIZZ"
              aria-label="Search WIZZ"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="mt-2 flex gap-1 overflow-x-auto no-scrollbar">
            {SEARCH_TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
                  tab === id
                    ? "bg-foreground text-background"
                    : "bg-secondary text-foreground hover:bg-secondary/80",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {!query && (
          <div>
            <h2 className="px-4 pb-1 pt-4 text-sm font-extrabold text-foreground">
              Trending topics
            </h2>
            <div className="flex flex-wrap gap-1.5 px-4 pb-4">
              {trends.map((t) => (
                <Link
                  key={t.id}
                  to="/topics/$topic"
                  params={{ topic: t.label.replace(/^#/, "").toLowerCase() }}
                  className="rounded-full bg-secondary px-3.5 py-1.5 text-xs font-bold text-foreground hover:bg-secondary/80"
                >
                  {t.label}
                </Link>
              ))}
            </div>
            <h2 className="px-4 pb-2 text-sm font-extrabold text-foreground">Categories</h2>
            <div className="grid grid-cols-2 gap-2 px-4 pb-4">
              {[
                "Tanzania",
                "Africa",
                "World",
                "Politics",
                "Business",
                "Technology",
                "Sports",
                "Entertainment",
              ].map((cat) => (
                <Link
                  key={cat}
                  to="/topics/$topic"
                  params={{ topic: cat.toLowerCase() }}
                  className="rounded-2xl bg-secondary/50 p-3 text-sm font-bold text-foreground hover:bg-secondary"
                >
                  {cat}
                </Link>
              ))}
            </div>
          </div>
        )}

        {query.length >= 2 && searchQuery.isLoading && (
          <div className="space-y-3 px-4 py-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-secondary" />
            ))}
          </div>
        )}

        {query.length >= 2 && searchQuery.data && (
          <div className="divide-y divide-border">
            {searchQuery.data.type === "people" &&
              (
                searchQuery.data.results as {
                  id: string;
                  username: string;
                  display_name: string;
                  avatar_url: string | null;
                  verified: boolean;
                  bio: string;
                }[]
              ).map((p) => (
                <Link
                  key={p.id}
                  to="/u/$username"
                  params={{ username: p.username }}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/50"
                >
                  {p.avatar_url ? (
                    <img
                      src={p.avatar_url}
                      alt={p.display_name}
                      className="size-10 rounded-full object-cover"
                    />
                  ) : (
                    <span className="grid size-10 place-items-center rounded-full bg-brand text-sm font-bold text-brand-foreground">
                      {p.display_name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-foreground">
                      {p.display_name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      @{p.username} · {p.bio}
                    </span>
                  </span>
                </Link>
              ))}
            {searchQuery.data.type === "posts" &&
              (
                searchQuery.data.results as {
                  id: string;
                  caption: string;
                  image_url: string | null;
                }[]
              ).map((p) => (
                <Link
                  key={p.id}
                  to="/post/$postId"
                  params={{ postId: p.id }}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/50"
                >
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="size-11 rounded-xl object-cover" />
                  ) : (
                    <span className="grid size-11 place-items-center rounded-xl bg-secondary text-xs text-muted-foreground">
                      Post
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {p.caption}
                  </span>
                </Link>
              ))}
            {searchQuery.data.type === "topics" &&
              (
                searchQuery.data.results as {
                  id: string;
                  label: string;
                  context: string;
                  post_count: number;
                }[]
              ).map((t) => (
                <Link
                  key={t.id}
                  to="/topics/$topic"
                  params={{ topic: t.label.replace(/^#/, "").toLowerCase() }}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/50"
                >
                  <span className="grid size-11 place-items-center rounded-xl bg-secondary">
                    <Hash className="size-4 text-brand" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-foreground">
                      {t.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t.context} · {formatCount(t.post_count)} posts
                    </span>
                  </span>
                </Link>
              ))}
          </div>
        )}

        {query.length >= 2 &&
          !searchQuery.isLoading &&
          searchQuery.data &&
          searchQuery.data.results.length === 0 && (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-bold text-foreground">No results for "{query}"</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Try different keywords or check spelling.
              </p>
            </div>
          )}
      </div>
    </AppShell>
  );
}

export function ExplorePending() {
  return (
    <AppShell title="Explore">
      <div className="mx-auto w-full max-w-2xl space-y-3 px-4 pt-4">
        <div className="h-10 w-full animate-pulse rounded-full bg-secondary" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-secondary" />
      </div>
    </AppShell>
  );
}

export function ExploreError({ reset }: { reset: () => void }) {
  return (
    <AppShell title="Explore">
      <div className="px-6 py-16 text-center">
        <p className="text-base font-bold">Unable to load explore</p>
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
