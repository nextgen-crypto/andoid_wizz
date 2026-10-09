import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ChevronLeft, Loader2, MessageCircle, Heart, Repeat2, Share2, Bookmark, BadgeCheck, Eye } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/frontend/components/AppShell";
import { useSession } from "@/frontend/hooks/useSession";
import { useAuthGate } from "@/frontend/hooks/useAuthGate";
import { usePostLikes } from "@/frontend/hooks/usePostLikes";
import { ReportDialog } from "@/frontend/components/moderation/ReportDialog";
import { formatCount, newsTimeAgo } from "@/frontend/components/news/newsFormat";
import { writeErrorMessage } from "@/frontend/lib/writeError";
import { cn } from "@/lib/utils";

export function PostDetailScreen() {
  const { postId } = useParams({ from: "/post/$postId" });
  const { user } = useSession();
  const requireAuth = useAuthGate();
  const queryClient = useQueryClient();
  const like = usePostLikes(postId, user?.id ?? null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [saved, setSaved] = useState(false);

  const postQuery = useQuery({
    queryKey: ["post-detail", postId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("posts").select("*, profiles!inner(id, username, display_name, avatar_url, verified)").eq("id", postId).eq("status", "published").maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as { id: string; caption: string; image_url: string | null; video_url: string | null; created_at: string; comments_count: number; author_id: string; profiles: { id: string; username: string; display_name: string; avatar_url: string | null; verified: boolean } | null };
      return {
        id: row.id,
        caption: row.caption ?? "",
        imageUrl: row.image_url,
        videoUrl: row.video_url ?? null,
        createdAt: row.created_at,
        commentsCount: row.comments_count ?? 0,
        author: row.profiles ? { id: row.profiles.id, username: row.profiles.username ?? "?", displayName: row.profiles.display_name ?? "?", avatarUrl: row.profiles.avatar_url, verified: row.profiles.verified === true } : null,
      };
    },
  });

  const commentsQuery = useQuery({
    queryKey: ["post-comments", postId],
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("comments").select("*, profiles!inner(id, username, display_name, avatar_url, verified)").eq("post_id", postId).eq("is_deleted", false).order("created_at", { ascending: true }).limit(50);
      if (error) throw error;
      return (data ?? []) as { id: string; body: string; created_at: string; profiles: { id: string; username: string; display_name: string; avatar_url: string | null; verified: boolean } | null }[];
    },
  });

  const replyMutation = useMutation({
    mutationFn: async () => {
      const text = draft.trim();
      if (!text) throw new Error("Empty reply");
      const { error } = await supabase.from("comments").insert({ post_id: postId, author_id: user!.id, body: text });
      if (error) throw error;
      setDraft("");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["post-comments", postId] });
      void queryClient.invalidateQueries({ queryKey: ["post-detail", postId] });
      toast("Reply posted.");
    },
    onError: (e) => toast.error(writeErrorMessage(e, "Could not reply.")),
  });

  if (postQuery.isLoading) {
    return <PostDetailPending />;
  }

  if (!postQuery.data) {
    return (
      <AppShell title="Post not found">
        <div className="px-6 py-16 text-center">
          <p className="text-base font-bold">Post not found</p>
          <Link to="/news" className="mt-4 inline-block rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-brand-foreground">Back to News</Link>
        </div>
      </AppShell>
    );
  }

  const post = postQuery.data;

  return (
    <AppShell title="Post">
      <div className="mx-auto w-full max-w-xl">
        <div className="sticky top-14 z-20 flex items-center gap-1 border-b border-border bg-background/95 px-2 py-1.5 backdrop-blur">
          <Link to="/news" aria-label="Back" className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-secondary">
            <ChevronLeft className="size-5" />
          </Link>
          <span className="min-w-0 flex-1 truncate text-sm font-bold">Post</span>
        </div>

        <article className="border-b border-border px-4 py-3">
          <div className="flex items-start gap-2.5">
            <Link to="/u/$username" params={{ username: post.author?.username ?? "" }}>
              {post.author?.avatarUrl ? (
                <img src={post.author.avatarUrl} alt={post.author.displayName} className="size-10 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-sm font-bold text-foreground">{(post.author?.displayName ?? "?").slice(0, 1).toUpperCase()}</span>
              )}
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1">
                <Link to="/u/$username" params={{ username: post.author?.username ?? "" }} className="truncate text-sm font-semibold text-foreground hover:underline">{post.author?.displayName ?? "Someone"}</Link>
                {post.author?.verified && <BadgeCheck className="size-4 shrink-0 text-brand" />}
                <span className="truncate text-xs text-muted-foreground">@{post.author?.username ?? "?"} · {newsTimeAgo(post.createdAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground">{post.caption}</p>
              {post.imageUrl && <img src={post.imageUrl} alt="" loading="lazy" className="mt-2 max-h-96 w-full rounded-xl border border-border object-cover" />}
              {post.videoUrl && <video src={post.videoUrl} controls playsInline preload="metadata" className="mt-2 max-h-96 w-full rounded-xl border border-border" />}
              <div className="mt-2 flex items-center gap-1 text-muted-foreground">
                <button aria-label="Like" aria-pressed={like.liked} onClick={() => { if (!requireAuth()) return; like.toggle(!like.liked); }} className="flex items-center gap-1.5 rounded-full px-2 py-1.5 hover:bg-secondary">
                  <Heart className={cn("size-4", like.liked && "fill-live text-live")} />
                  <span className="text-xs font-semibold">{formatCount(like.count)}</span>
                </button>
                <span className="flex items-center gap-1.5 rounded-full px-2 py-1.5"><MessageCircle className="size-4" /><span className="text-xs font-semibold">{formatCount(post.commentsCount)}</span></span>
                <span className="flex items-center gap-1.5 rounded-full px-2 py-1.5"><Eye className="size-4" /><span className="text-xs font-semibold">0</span></span>
                <button aria-label="Share" onClick={() => { try { void navigator.clipboard.writeText(`${window.location.origin}/post/${post.id}`); toast("Link copied."); } catch { toast("Could not copy link."); } }} className="rounded-full p-2 hover:bg-secondary"><Share2 className="size-4" /></button>
                <button aria-label={saved ? "Unsave" : "Save"} aria-pressed={saved} onClick={() => { if (!requireAuth()) return; setSaved(v => !v); toast(saved ? "Removed from saved." : "Saved."); }} className="rounded-full p-2 hover:bg-secondary"><Bookmark className={cn("size-4", saved && "fill-brand text-brand")} /></button>
              </div>
            </div>
          </div>
        </article>

        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") replyMutation.mutate(); }}
            placeholder="Post your reply"
            aria-label="Post your reply"
            className="min-w-0 flex-1 rounded-full bg-secondary px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button onClick={() => replyMutation.mutate()} disabled={!draft.trim() || posting} className="shrink-0 rounded-full bg-foreground px-5 py-2.5 text-sm font-bold text-background disabled:opacity-50">
            {posting ? "Posting…" : "Reply"}
          </button>
        </div>

        {commentsQuery.isLoading ? (
          <div className="space-y-3 px-4 py-4">
            {[0, 1].map((i) => <div key={i} className="h-12 animate-pulse rounded-2xl bg-secondary" />)}
          </div>
        ) : commentsQuery.data?.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">No replies yet — start the conversation.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {commentsQuery.data?.map((c) => (
              <div key={c.id} className="flex items-start gap-2.5 px-4 py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-foreground">{(c.profiles?.display_name ?? "?").slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="truncate text-sm font-semibold text-foreground">{c.profiles?.display_name ?? "Someone"}</span>
                    {c.profiles?.verified && <BadgeCheck className="size-3.5 shrink-0 text-brand" />}
                    <span className="truncate text-xs text-muted-foreground">@{c.profiles?.username ?? "?"} · {newsTimeAgo(c.created_at)}</span>
                  </div>
                  <p className="mt-0.5 text-sm leading-relaxed text-foreground">{c.body}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {reporting && <ReportDialog open onClose={() => setReporting(false)} target={{ kind: "post", refId: post.id, refTitle: post.caption.slice(0, 80), ...(post.author?.id ? { targetUserId: post.author.id } : {}) }} />}
    </AppShell>
  );
}

export function PostDetailPending() {
  return <AppShell title="Post"><div className="mx-auto w-full max-w-xl space-y-3 px-4 pt-4"><div className="h-8 w-3/4 animate-pulse rounded bg-secondary" /><div className="h-4 w-full animate-pulse rounded bg-secondary" /><div className="h-4 w-5/6 animate-pulse rounded bg-secondary" /></div></AppShell>;
}

export function PostDetailError({ reset }: { reset: () => void }) {
  return <AppShell title="Post"><div className="px-6 py-16 text-center"><p className="text-base font-bold">Unable to load post</p><button onClick={reset} className="mt-4 rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-brand-foreground">Retry</button></div></AppShell>;
}
