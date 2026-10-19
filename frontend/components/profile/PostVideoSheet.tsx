import { useState } from "react";
import { publicUrl } from "@/frontend/lib/native";
import { Heart, MessageCircle, Share2, Bookmark, X } from "lucide-react";
import { PostMenu } from "@/frontend/components/profile/PostMenu";
import { ShareSheet } from "@/frontend/components/overlays/ShareSheet";
import { usePostLikes } from "@/frontend/hooks/usePostLikes";
import { usePostComments } from "@/frontend/hooks/usePostComments";
import { useSavedPosts, useToggleSave } from "@/frontend/hooks/useSavedPosts";
import { useComments } from "@/frontend/components/comments/CommentsContext";
import { useAuthGate } from "@/frontend/hooks/useAuthGate";
import { cn } from "@/lib/utils";
import type { ProfilePost } from "@/frontend/hooks/useMyProfileData";

const compact = new Intl.NumberFormat("en", { notation: "compact" });

/**
 * Full-screen player for a profile post, modeled on the shorts surface:
 * video fills the screen, action rail on the right (like / comments /
 * share / save / more). The owner-aware three-dot menu lives in the
 * rail's More slot — never on the profile grid.
 */
export function PostVideoSheet({
  post,
  isOwner,
  userId,
  username,
  onClose,
  onEdit,
  onHidden,
  onDeleted,
}: {
  post: ProfilePost;
  isOwner: boolean;
  userId: string | null;
  username?: string;
  onClose: () => void;
  onEdit?: () => void;
  onHidden?: (id: string) => void;
  onDeleted?: (id: string) => void;
}) {
  const requireAuth = useAuthGate();
  const [sharing, setSharing] = useState(false);
  const { openComments } = useComments();
  // Profile posts are real Supabase rows; comment count + save state read the
  // shared stores so they match everywhere else in the app.
  const comments = usePostComments(isUuid(post.id) ? post.id : null, userId);
  const { data: savedPosts = [] } = useSavedPosts(userId);
  const isSaved = savedPosts.some((p) => p.id === post.id);
  const toggleSave = useToggleSave(userId);
  const postLike = usePostLikes(isUuid(post.id) ? post.id : null, userId);

  const shareUrl =
    typeof window !== "undefined" && username
      ? publicUrl(`/u/${username}#post-${post.id}`)
      : `post-${post.id}`;

  return (
    <div className="fixed inset-0 z-50 mx-auto flex w-full max-w-3xl flex-col bg-black">
      <video
        src={post.video_url ?? ""}
        poster={post.thumbnail_url || post.image_url || undefined}
        controls
        autoPlay
        playsInline
        loop
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute left-3 top-3 z-10">
        <button
          aria-label="Close player"
          onClick={onClose}
          className="grid size-9 place-items-center rounded-full bg-black/45 text-white"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Bottom-left meta */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-scrim to-transparent pb-24 pt-20">
        <div className="max-w-[calc(100%-5rem)] px-4">
          <p className="text-base font-bold text-on-media">@{username ?? "wizz"}</p>
          <p className="mt-1 line-clamp-3 text-sm text-on-media/95">{post.caption}</p>
        </div>
      </div>

      {/* Right action rail, like Shorts */}
      <div className="absolute bottom-24 right-3 z-10 flex flex-col items-center gap-4">
        <button
          aria-label="Like"
          aria-pressed={postLike.liked}
          onClick={() => {
            if (!requireAuth()) return;
            postLike.toggle(!postLike.liked);
          }}
          className="press flex flex-col items-center gap-1"
        >
          <Heart
            className={cn(
              "size-7",
              postLike.liked ? "animate-pop fill-live text-live" : "text-on-media",
            )}
          />
          <span className="text-[11px] font-semibold text-on-media">
            {compact.format(postLike.count)}
          </span>
        </button>
        <button
          aria-label="Comments"
          onClick={() => {
            if (!requireAuth()) return;
            openComments(post.id);
          }}
          className="press flex flex-col items-center gap-1"
        >
          <MessageCircle className="size-7 text-on-media" />
          <span className="text-[11px] font-semibold text-on-media">
            {compact.format(comments.data?.total ?? 0)}
          </span>
        </button>
        <button
          aria-label="Share"
          onClick={() => setSharing(true)}
          className="press flex flex-col items-center gap-1"
        >
          <Share2 className="size-7 text-on-media" />
          <span className="text-[11px] font-semibold text-on-media">Share</span>
        </button>
        <button
          aria-label="Save"
          aria-pressed={isSaved}
          onClick={() => {
            if (!requireAuth()) return;
            if (!toggleSave.remote) return;
            toggleSave.mutate({ postId: post.id, save: !isSaved });
          }}
          className="press flex flex-col items-center gap-1"
        >
          <Bookmark className={cn("size-7", isSaved ? "fill-brand text-brand" : "text-on-media")} />
          <span className="text-[11px] font-semibold text-on-media">Save</span>
        </button>
        {/* More — owner gets delete/edit/archive, viewers get save/share/report */}
        <div
          className="press flex flex-col items-center gap-1"
          onClick={(e) => {
            // Tapping the label area should open the menu too, not only the icon
            const btn = e.currentTarget.querySelector<HTMLButtonElement>("button");
            if (btn && e.target !== btn && !btn.contains(e.target as Node)) btn.click();
          }}
        >
          <PostMenu
            post={post}
            isOwner={isOwner}
            size="sm"
            userId={userId}
            {...(username ? { username } : {})}
            {...(onEdit ? { onEdit } : {})}
            {...(onHidden ? { onHidden } : {})}
            {...(onDeleted ? { onDeleted } : {})}
          />
          <span className="text-[11px] font-semibold text-on-media">More</span>
        </div>
      </div>

      {sharing && (
        <ShareSheet
          open
          onClose={() => setSharing(false)}
          url={shareUrl}
          message={post.caption.slice(0, 80) || "Check this out on WIZZ"}
        />
      )}
    </div>
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
