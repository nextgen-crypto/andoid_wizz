import { Link } from "@tanstack/react-router";
import { Search, TrendingUp, UserPlus, MessageCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { trendingTopicsQueryOptions } from "@/frontend/hooks/useTrendingTopics";
import { useSuspenseQuery } from "@tanstack/react-query";
import { formatCount } from "@/frontend/components/news/newsFormat";

export function NewsSidebar() {
  const { data: trends = [] } = useSuspenseQuery(trendingTopicsQueryOptions);
  const { data: suggested = [] } = useQuery({
    queryKey: ["news-suggested-people"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, username, display_name, avatar_url, verified").eq("verified", true).limit(5);
      if (error) throw error;
      return (data ?? []) as { id: string; username: string; display_name: string; avatar_url: string | null; verified: boolean }[];
    },
  });

  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-80 shrink-0 overflow-y-auto border-l border-border px-4 py-4 xl:block">
      <div className="flex items-center gap-2 rounded-full bg-secondary px-3.5 py-2.5">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input placeholder="Search WIZZ" aria-label="Search WIZZ" className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
      </div>

      {trends.length > 0 && (
        <section className="mt-4 rounded-2xl bg-secondary/50 p-3" aria-label="Trending">
          <h2 className="flex items-center gap-1.5 px-1 text-base font-extrabold text-foreground">
            <TrendingUp className="size-4 text-brand" /> Trending
          </h2>
          <div className="mt-2 space-y-0.5">
            {trends.slice(0, 5).map((t) => (
              <Link key={t.id} to="/topics/$topic" params={{ topic: t.label.replace(/^#/, "").toLowerCase() }} className="block rounded-xl px-2 py-2 hover:bg-secondary">
                <p className="text-sm font-bold text-foreground">{t.label}</p>
                <p className="text-xs text-muted-foreground">{t.context} · {formatCount(t.postCount)} posts</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {suggested.length > 0 && (
        <section className="mt-4 rounded-2xl bg-secondary/50 p-3" aria-label="Suggested accounts">
          <h2 className="flex items-center gap-1.5 px-1 text-base font-extrabold text-foreground">
            <UserPlus className="size-4 text-brand" /> Who to follow
          </h2>
          <div className="mt-2 space-y-0.5">
            {suggested.map((p) => (
              <Link key={p.id} to="/u/$username" params={{ username: p.username }} className="flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-secondary">
                {p.avatar_url ? (
                  <img src={p.avatar_url} alt={p.display_name} className="size-8 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-brand-foreground">{p.display_name.slice(0, 1).toUpperCase()}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-foreground">{p.display_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">@{p.username}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="mt-4 px-2 text-[11px] leading-relaxed text-muted-foreground">
        Terms · Privacy · Accessibility · Ads info · More
      </p>
    </aside>
  );
}
