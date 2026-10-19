import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, MessageCircle, Heart, Share2, Bookmark, BadgeCheck, Eye } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { publicUrl } from "@/frontend/lib/native";
import { AppShell } from "@/frontend/components/AppShell";
import { useSession } from "@/frontend/hooks/useSession";
import { useAuthGate } from "@/frontend/hooks/useAuthGate";
import { usePostLikes } from "@/frontend/hooks/usePostLikes";
import { usePostComments } from "@/frontend/hooks/usePostComments";
import { useSavedPosts, useToggleSave } from "@/frontend/hooks/useSavedPosts";
import { useComments } from "@/frontend/components/comments/CommentsContext";
import { ReportDialog } from "@/frontend/components/moderation/ReportDialog";
import { formatCount, newsTimeAgo } from "@/frontend/components/news/newsFormat";
import { cn } from "@/lib/utils";

export function PostDetailScreen() {
  const { postId } = useParams({ from: "/post/$postId" });
  const { user } = useSession();
  const requireAuth = useAuthGate();
  const userId = user?.id ?? null;
  const like = usePostLikes(postId, userId);
  const { openComments } = useComments();
  const comments = usePostComments(postId, userId);
  const { data: savedPosts = [] } = useSavedPosts(userId);
  const toggleSave = useToggleSave(userId);
  const [reporting, setReporting] = useState(false);
  const isSaved = savedPosts.some((p) => p.id === postId);

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
                <button aria-label="Comment" onClick={() => { if (!requireAuth()) return; openComments(postId); }} className="flex items-center gap-1.5 rounded-full px-2 py-1.5 hover:bg-secondary">
                  <MessageCircle className="size-4" />
                  <span className="text-xs font-semibold">{formatCount(comments.data?.total ?? 0)}</span>
                </button>
                <span className="flex items-center gap-1.5 rounded-full px-2 py-1.5"><Eye className="size-4" /><span className="text-xs font-semibold">0</span></span>
                <button aria-label="Share" onClick={() => { try { void navigator.clipboard.writeText(publicUrl(`/post/${post.id}`)); toast("Link copied."); } catch { toast("Could not copy link."); } }} className="rounded-full p-2 hover:bg-secondary"><Share2 className="size-4" /></button>
                <button aria-label={isSaved ? "Unsave" : "Save"} aria-pressed={isSaved} onClick={() => { if (!requireAuth()) return; if (!toggleSave.remote) { toast("Sign in to save posts."); return; } toggleSave.mutate({ postId, save: !isSaved }); toast(isSaved ? "Removed from saved." : "Saved."); }} className="rounded-full p-2 hover:bg-secondary"><Bookmark className={cn("size-4", isSaved && "fill-brand text-brand")} /></button>
              </div>
            </div>
          </div>
        </article>

        {/* Comment preview — reads the same shared store as the sheet, then
            opens the one global <CommentsSheet>. */}
        <button
          onClick={() => { if (!requireAuth()) return; openComments(postId); }}
          className="flex w-full items-center gap-2 border-b border-border px-4 py-3 text-left hover:bg-secondary"
        >
          <MessageCircle className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {comments.data?.comments[0] ? (
              <>
                <span className="font-semibold text-foreground">{comments.data.comments[0].user}</span>{" "}
                {comments.data.comments[0].text}
              </>
            ) : (
              "View all comments"
            )}
          </span>
          <span className="shrink-0 text-xs font-semibold text-muted-foreground">
            {formatCount(comments.data?.total ?? 0)}
          </span>
        </button>
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
