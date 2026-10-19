import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { BadgeCheck, Bookmark, Eye, Heart, MessageCircle, MoreHorizontal, Repeat2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/frontend/hooks/useSession";
import { useAuthGate } from "@/frontend/hooks/useAuthGate";
import { usePostLikes } from "@/frontend/hooks/usePostLikes";
import { publicUrl } from "@/frontend/lib/native";
import { ReportDialog } from "@/frontend/components/moderation/ReportDialog";
import { formatCount, newsTimeAgo } from "@/frontend/components/news/newsFormat";
import { cn } from "@/lib/utils";

export interface NewsFeedPost {
  id: string;
  caption: string;
  imageUrl: string | null;
  videoUrl: string | null;
  createdAt: string;
  commentsCount: number;
  views: number;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    verified: boolean;
  } | null;
}

export function NewsFeedCard({ post }: { post: NewsFeedPost }) {
  const { user } = useSession();
  const requireAuth = useAuthGate();
  const like = usePostLikes(post.id, user?.id ?? null);
  const [saved, setSaved] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);

  function copyLink() {
    try {
      void navigator.clipboard.writeText(publicUrl(`/post/${post.id}`));
      toast("Link copied.");
    } catch {
      toast("Could not copy link.");
    }
  }

  return (
    <article className="border-b border-border px-4 py-3">
      <div className="flex items-start gap-2.5">
        <Link to="/u/$username" params={{ username: post.author?.username ?? "" }}>
          {post.author?.avatarUrl ? (
            <img src={post.author.avatarUrl} alt={post.author.displayName} loading="lazy" className="size-10 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-sm font-bold text-foreground">
              {(post.author?.displayName ?? "?").slice(0, 1).toUpperCase()}
            </span>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <Link to="/u/$username" params={{ username: post.author?.username ?? "" }} className="truncate text-sm font-semibold text-foreground hover:underline">
              {post.author?.displayName ?? "Someone"}
            </Link>
            {post.author?.verified && <BadgeCheck className="size-4 shrink-0 text-brand" />}
            <span className="truncate text-xs text-muted-foreground">@{post.author?.username ?? "?"} · {newsTimeAgo(post.createdAt)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground">{post.caption}</p>
          {post.imageUrl && (
            <img src={post.imageUrl} alt="" loading="lazy" className="mt-2 max-h-96 w-full rounded-xl border border-border object-cover" />
          )}
          {post.videoUrl && (
            <video src={post.videoUrl} controls playsInline preload="metadata" className="mt-2 max-h-96 w-full rounded-xl border border-border" />
          )}
          <div className="mt-2 flex items-center gap-1 text-muted-foreground">
            <Link to="/post/$postId" params={{ postId: post.id }} className="flex items-center gap-1.5 rounded-full px-2 py-1.5 hover:bg-secondary">
              <MessageCircle className="size-4" />
              <span className="text-xs font-semibold">{formatCount(post.commentsCount)}</span>
            </Link>
            <button
              aria-label="Repost"
              aria-pressed={reposted}
              onClick={() => { if (!requireAuth()) return; setReposted(v => !v); }}
              className="flex items-center gap-1.5 rounded-full px-2 py-1.5 hover:bg-secondary"
            >
              <Repeat2 className={cn("size-4", reposted && "text-brand")} />
              <span className="text-xs font-semibold">{formatCount(reposted ? 1 : 0)}</span>
            </button>
            <button
              aria-label="Like"
              aria-pressed={like.liked}
              onClick={() => { if (!requireAuth()) return; like.toggle(!like.liked); }}
              className="flex items-center gap-1.5 rounded-full px-2 py-1.5 hover:bg-secondary"
            >
              <Heart className={cn("size-4", like.liked && "fill-live text-live")} />
              <span className="text-xs font-semibold">{formatCount(like.count)}</span>
            </button>
            <span className="flex items-center gap-1.5 rounded-full px-2 py-1.5">
              <Eye className="size-4" />
              <span className="text-xs font-semibold">{formatCount(post.views)}</span>
            </span>
            <button aria-label="Share" onClick={copyLink} className="rounded-full p-2 hover:bg-secondary">
              <Share2 className="size-4" />
            </button>
            <span className="flex-1" />
            <button
              aria-label={saved ? "Unsave" : "Save"}
              aria-pressed={saved}
              onClick={() => { if (!requireAuth()) return; setSaved(v => !v); toast(saved ? "Removed from saved." : "Saved."); }}
              className="rounded-full p-2 hover:bg-secondary"
            >
              <Bookmark className={cn("size-4", saved && "fill-brand text-brand")} />
            </button>
          </div>
        </div>
        <span className="relative shrink-0">
          <button aria-label="Post options" aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)} className="rounded-full p-1 hover:bg-secondary">
            <MoreHorizontal className="size-4 text-muted-foreground" />
          </button>
          {menuOpen && (
            <>
              <button aria-label="Close menu" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-10 cursor-default" />
              <div className="absolute right-0 top-8 z-20 w-44 overflow-hidden rounded-2xl border border-border bg-card shadow-raise">
                <button onClick={() => { setMenuOpen(false); copyLink(); }} className="block w-full px-3 py-2.5 text-left text-sm font-medium hover:bg-secondary">Copy link</button>
                <button onClick={() => { setMenuOpen(false); setReporting(true); }} className="block w-full px-3 py-2.5 text-left text-sm font-medium text-live hover:bg-secondary">Report</button>
              </div>
            </>
          )}
        </span>
      </div>
      {reporting && (
        <ReportDialog open onClose={() => setReporting(false)} target={{ kind: "post", refId: post.id, refTitle: post.caption.slice(0, 80), ...(post.author?.id ? { targetUserId: post.author.id } : {}) }} />
      )}
    </article>
  );
}
