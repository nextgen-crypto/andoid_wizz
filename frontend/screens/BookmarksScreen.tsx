import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/frontend/components/AppShell";
import { useSession } from "@/frontend/hooks/useSession";

export function BookmarksScreen() {
  const { user } = useSession();

  const { data: bookmarks = [], isLoading } = useQuery({
    queryKey: ["bookmarks", user?.id],
    enabled: Boolean(user),
    staleTime: 30_000,
    queryFn: async () => {
      if (!user) return [];
      const { data: storySaves, error: storyErr } = await supabase.from("story_saves").select("story_id, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
      if (storyErr) throw storyErr;
      const storyIds = (storySaves ?? []).map((s: { story_id: string }) => s.story_id);
      let stories: { id: string; headline: string; category: string; created_at: string }[] = [];
      if (storyIds.length > 0) {
        const { data: storyData, error: storyDataErr } = await supabase.from("news_stories").select("id, headline, category, created_at").in("id", storyIds);
        if (storyDataErr) throw storyDataErr;
        stories = storyData ?? [];
      }
      const { data: postSaves, error: postErr } = await supabase.from("saves").select("post_id, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
      if (postErr) throw postErr;
      const postIds = (postSaves ?? []).map((s: { post_id: string }) => s.post_id);
      let posts: { id: string; caption: string; created_at: string; author_id: string }[] = [];
      if (postIds.length > 0) {
        const { data: postData, error: postDataErr } = await supabase.from("posts").select("id, caption, created_at, author_id").in("id", postIds);
        if (postDataErr) throw postDataErr;
        posts = postData ?? [];
      }
      return [
        ...stories.map((s) => ({ id: s.id, type: "story" as const, title: s.headline, meta: `${s.category} · ${new Date(s.created_at).toLocaleDateString()}`, createdAt: s.created_at })),
        ...posts.map((p) => ({ id: p.id, type: "post" as const, title: p.caption.slice(0, 100), meta: `Post · ${new Date(p.created_at).toLocaleDateString()}`, createdAt: p.created_at })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  });

  return (
    <AppShell title="Bookmarks">
      <div className="mx-auto w-full max-w-2xl">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-xl font-black tracking-tight text-foreground">Bookmarks</h1>
        </div>
        {isLoading ? (
          <div className="space-y-3 px-4 py-4">
            {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-secondary" />)}
          </div>
        ) : bookmarks.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Bookmark className="mx-auto size-10 text-muted-foreground" />
            <p className="mt-3 text-sm font-bold text-foreground">No bookmarks yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Save stories and posts to find them later.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {bookmarks.map((b) => (
              <Link key={b.id} to={b.type === "story" ? "/news/$articleId" : "/post/$postId"} params={b.type === "story" ? { articleId: b.id } : { postId: b.id }} className="block px-4 py-3 hover:bg-secondary/50">
                <p className="text-xs font-bold uppercase tracking-wider text-brand">{b.type}</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{b.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{b.meta}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

export function BookmarksPending() {
  return <AppShell title="Bookmarks"><div className="mx-auto w-full max-w-2xl space-y-3 px-4 pt-4"><div className="h-7 w-32 animate-pulse rounded bg-secondary" /><div className="h-16 animate-pulse rounded-2xl bg-secondary" /></div></AppShell>;
}

export function BookmarksError({ reset }: { reset: () => void }) {
  return <AppShell title="Bookmarks"><div className="px-6 py-16 text-center"><p className="text-base font-bold">Unable to load bookmarks</p><button onClick={reset} className="mt-4 rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-brand-foreground">Retry</button></div></AppShell>;
}
