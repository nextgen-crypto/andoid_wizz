import { useEffect, useRef, useState } from "react";
import { publicUrl } from "@/frontend/lib/native";
import {
  BadgeCheck,
  Bookmark,
  EyeOff,
  Flag,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Play,
  Share2,
  UserX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { imageSrcSet, imageUrl, placeholderUrl, videoUrl } from "@/backend/domain/media";
import type { FeedItem } from "@/backend/services/feedService";
import { ShareSheet } from "@/frontend/components/overlays/ShareSheet";
import { ReportDialog, type ReportTarget } from "@/frontend/components/moderation/ReportDialog";
import { useSession } from "@/frontend/hooks/useSession";
import { isPremiumActive } from "@/frontend/lib/membership";
import { useAuthGate } from "@/frontend/hooks/useAuthGate";
import { useMyProfile } from "@/frontend/hooks/useMyProfile";
import { usePostComments } from "@/frontend/hooks/usePostComments";
import { useDemoComments } from "@/frontend/hooks/useDemoComments";
import { useComments } from "@/frontend/components/comments/CommentsContext";
import { usePostLikes } from "@/frontend/hooks/usePostLikes";
import { useFollowState } from "@/frontend/hooks/usePublicProfile";
import { useSavedPosts, useToggleSave } from "@/frontend/hooks/useSavedPosts";
import type { FeedEvent } from "@/frontend/hooks/useEventTracker";
import { cn } from "@/lib/utils";
import { visibleHashtags } from "@/frontend/lib/hashtags";
import { timeAgoCompact } from "@/frontend/lib/format";
import { neutralizeBrokenImage } from "@/frontend/lib/mediaFormat";

const compact = new Intl.NumberFormat("en", { notation: "compact" });
const DOUBLE_TAP_MS = 280;
const SEED_SELF_ID = "u-alex";

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** Deterministic clock so SSR markup and hydrated markup agree exactly. */
const REFERENCE_NOW = Date.parse("2026-08-27T12:00:00.000Z");

export function FeedCard({
  item,
  index = 0,
  onWatch,
  onHidePost,
  onNotInterested,
  onMuteAuthor,
  track,
}: {
  item: FeedItem;
  index?: number;
  onWatch?: (postId: string, completed: boolean) => void;
  onHidePost?: (postId: string) => void;
  onNotInterested?: (postId: string) => void;
  onMuteAuthor?: (authorId: string, username: string) => void;
  track?: (
    event: FeedEvent,
    postId: string,
    extra?: { authorId?: string; meta?: Record<string, string | number | boolean> },
  ) => void;
}) {
  const { post, author, clipObjectKey } = item;
  const clipSrc = item.videoSrc ?? (clipObjectKey ? videoUrl(clipObjectKey) : undefined);
  const [localSaved, setLocalSaved] = useState(false);
  const [localFollowing, setLocalFollowing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [burst, setBurst] = useState(0);
  const tapTimer = useRef<number | null>(null);
  const completedRef = useRef(false);
  const playCountRef = useRef(0);
  const progressRef = useRef<Set<number>>(new Set());
  const impressedRef = useRef(false);
  const articleRef = useRef<HTMLElement | null>(null);
  const shareUrl = typeof window !== "undefined" ? publicUrl(`/u/${author.username}`) : "";

  const { user, displayName } = useSession();
  const requireAuth = useAuthGate();
  const userId = user?.id ?? null;
  const { data: myProfile } = useMyProfile(userId);
  const { data: savedPosts = [] } = useSavedPosts(userId);
  const toggleSave = useToggleSave(userId);

  // Seed authors ("u-maya") aren't real profiles, so those Follow buttons stay
  // local. Genuine profile UUIDs are followed in the `follows` table, which is
  // what the follower/following counters read from.
  const realAuthor = isUuid(author.id) && userId !== null && author.id !== userId;
  const { isFollowing: followedInDb, toggle: followToggle } = useFollowState(
    realAuthor ? userId : null,
    realAuthor ? author.id : null,
  );
  const following = realAuthor ? followedInDb : localFollowing;

  // Real likes for Supabase posts (fires author notifications via trigger);
  // seed items stay local.
  const [localPostLiked, setLocalPostLiked] = useState(false);
  const postLike = usePostLikes(isUuid(post.id) ? post.id : null, userId);
  const likeReal = isUuid(post.id) && userId !== null && postLike.remote;
  const liked = likeReal ? postLike.liked : localPostLiked;
  const likeCount = likeReal ? postLike.count : post.metrics.likes + (localPostLiked ? 1 : 0);

  // ONE source of truth per post: live Supabase comments for real posts,
  // localStorage demo comments for seed items. The badge, the inline preview,
  // and the global comments sheet all read this same data, so they can never
  // disagree (fixes the old card=1 / sheet=0 mismatch caused by falling back
  // to the denormalized `posts.comments_count`, which counted replies and
  // wasn't RLS-filtered).
  const isRealPost = isUuid(post.id);
  const { openComments } = useComments();
  const remote = usePostComments(isRealPost ? post.id : null, userId);
  const demo = useDemoComments(isRealPost ? null : post.id, displayName || "you");

  const uiComments = isRealPost ? (remote.data?.comments ?? []) : demo.comments;
  const totalComments = isRealPost ? (remote.data?.total ?? 0) : demo.total;
  const preview: { user: string; text: string } | undefined = uiComments[0];

  function openCardComments() {
    if (!requireAuth()) return;
    openComments(post.id);
  }

  // Real saves only work for Supabase posts + signed-in viewers; seed items fall back local.
  const realCapable = isUuid(post.id) && userId !== null && toggleSave.remote;
  const realSaved = realCapable && savedPosts.some((p) => p.id === post.id);
  const saved = realCapable ? realSaved : localSaved;

  function toggleSavePost() {
    const saving = realCapable ? !realSaved : !localSaved;
    if (realCapable && userId) {
      toggleSave.mutate({ postId: post.id, save: saving });
    } else {
      setLocalSaved((v) => !v);
    }
    if (saving) track?.("video_save", post.id, { authorId: author.id });
  }

  // Never offer "Follow" on your own posts.
  const isSelf =
    (userId !== null && author.id === userId) ||
    author.username === myProfile?.username ||
    (userId === null && author.id === SEED_SELF_ID);

  const image = post.media.find((m) => m.kind === "image");
  const aspect = image ? image.width / image.height : 1;
  const commentsEnabled = post.commentsEnabled !== false;
  const sharingEnabled = post.allowSharing !== false;
  const appendedHashtags = visibleHashtags(post.caption, post.hashtags);

  function likeWithBurst() {
    if (!requireAuth()) return;
    if (!liked) {
      if (likeReal && userId) {
        postLike.toggle(true);
      } else {
        setLocalPostLiked(true);
      }
      setBurst((n) => n + 1);
      track?.("video_like", post.id, { authorId: author.id });
    } else {
      if (likeReal && userId) {
        postLike.toggle(false);
      } else {
        setLocalPostLiked(false);
      }
    }
  }

  /** Mobile-reliable double-tap (onDoubleClick is flaky on touch). */
  function handleMediaTap() {
    if (tapTimer.current) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = null;
      likeWithBurst();
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
    }, DOUBLE_TAP_MS);
  }

  function reportWatch(completed: boolean) {
    if (completed) {
      if (completedRef.current) return;
      completedRef.current = true;
    }
    onWatch?.(post.id, completed);
  }

  // Impression: visible ≥50% for 1s counts as seen (drives engagement rate).
  useEffect(() => {
    const el = articleRef.current;
    if (!el || impressedRef.current) return;
    let timer: number | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          timer ??= window.setTimeout(() => {
            impressedRef.current = true;
            track?.("video_impression", post.id, { authorId: author.id });
            io.disconnect();
          }, 1000);
        } else if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [post.id, author.id, track]);

  // Skip: seen but never played.
  useEffect(
    () => () => {
      if (impressedRef.current && playCountRef.current === 0) {
        track?.("video_skip", post.id, { authorId: author.id });
      }
    },
    [post.id, author.id, track],
  );

  if (dismissed) return null;

  return (
    <article
      ref={articleRef}
      className="animate-fade-up border-b border-border bg-card"
      style={{ animationDelay: `${Math.min(index, 6) * 60}ms` }}
    >
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-start gap-2 px-3 pt-3 sm:gap-3 sm:px-5">
        <img
          src={imageUrl(author.avatarKey, "thumbnail")}
          alt={author.displayName}
          loading="lazy"
          onError={neutralizeBrokenImage}
          className="size-9 shrink-0 rounded-full object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate text-sm font-bold text-foreground">{author.displayName}</span>
            {(author.verified || isPremiumActive(author.premiumUntil)) && (
              <BadgeCheck className="size-4 shrink-0 text-brand" aria-label="Verified" />
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            @{author.username} · {timeAgoCompact(post.createdAt, REFERENCE_NOW)}
          </p>
        </div>
        {!isSelf && (
          <button
            onClick={() => {
              if (!requireAuth()) return;
              if (realAuthor) {
                followToggle.mutate(!followedInDb);
                return;
              }
              setLocalFollowing((v) => !v);
            }}
            disabled={realAuthor && followToggle.isPending}
            className="shrink-0 pt-0.5 text-sm font-semibold text-brand disabled:opacity-60"
          >
            {following ? "Following" : "Follow"}
          </button>
        )}
        <span className="relative shrink-0">
          <button
            aria-label="More options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="-mr-1 rounded-full p-1 hover:bg-secondary"
          >
            <MoreHorizontal className="size-5 text-muted-foreground" />
          </button>
          {menuOpen && (
            <>
              <button
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div className="absolute right-0 top-8 z-20 w-52 overflow-hidden rounded-2xl border border-border bg-card shadow-raise">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onNotInterested?.(post.id);
                    toast("We'll show you less like this");
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium hover:bg-secondary"
                >
                  <EyeOff className="size-4 text-muted-foreground" /> Not interested
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setDismissed(true);
                    onHidePost?.(post.id);
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium hover:bg-secondary"
                >
                  <X className="size-4 text-muted-foreground" /> Hide this post
                </button>
                {!isSelf && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setDismissed(true);
                      onMuteAuthor?.(author.id, author.username);
                      toast(`Muted @${author.username}`);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium hover:bg-secondary"
                  >
                    <UserX className="size-4 text-muted-foreground" /> Mute @{author.username}
                  </button>
                )}
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setReportTarget({
                      kind: "post",
                      refId: post.id,
                      refTitle: post.caption || "Photo post",
                      targetUserId: author.id,
                    });
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium hover:bg-secondary"
                >
                  <Flag className="size-4 text-muted-foreground" /> Report
                </button>
              </div>
            </>
          )}
        </span>
      </header>

      <p className="break-words px-3 py-3 text-[15px] leading-snug text-foreground sm:px-5">
        {post.caption}
        {appendedHashtags.length > 0 && (
          <span className="text-brand"> {appendedHashtags.map((h) => `#${h}`).join(" ")}</span>
        )}
      </p>

      {clipSrc ? (
        <div className="relative bg-surface-strong" onClick={handleMediaTap}>
          <video
            className="aspect-[4/5] w-full object-cover"
            src={clipSrc}
            poster={imageUrl(image?.objectKey ?? post.id, "large", 0.8)}
            playsInline
            loop
            muted
            controls={playing}
            preload="none"
            onPlay={() => {
              setPlaying(true);
              reportWatch(false);
              playCountRef.current += 1;
              track?.(playCountRef.current > 1 ? "video_replay" : "video_play", post.id, {
                authorId: author.id,
              });
            }}
            onPause={() => track?.("video_pause", post.id, { authorId: author.id })}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (!(v.duration > 0)) return;
              const pct = v.currentTime / v.duration;
              for (const mark of [0.25, 0.5, 0.75]) {
                if (pct >= mark && !progressRef.current.has(mark)) {
                  progressRef.current.add(mark);
                  track?.("video_progress", post.id, { authorId: author.id, meta: { pct: mark } });
                }
              }
              if (pct > 0.8 && !completedRef.current) {
                reportWatch(true);
                track?.("video_complete", post.id, { authorId: author.id });
              }
            }}
          />
          {!playing && (
            <button
              aria-label="Play video"
              onClick={(e) => {
                const video = e.currentTarget.previousElementSibling as HTMLVideoElement | null;
                setPlaying(true);
                void video?.play()?.catch(() => undefined);
              }}
              className="absolute inset-0 grid place-items-center bg-scrim/20"
            >
              <span className="grid size-14 place-items-center rounded-full bg-on-media/90">
                <Play className="size-6 translate-x-0.5 fill-foreground text-foreground" />
              </span>
            </button>
          )}
        </div>
      ) : image ? (
        <div className="relative" onClick={handleMediaTap}>
          <img
            src={imageUrl(image.objectKey, "large", aspect)}
            srcSet={imageSrcSet(image.objectKey, aspect)}
            sizes="(max-width: 768px) 100vw, 768px"
            alt={image.alt}
            width={image.width}
            height={image.height}
            loading="lazy"
            decoding="async"
            onError={neutralizeBrokenImage}
            style={{
              backgroundImage: `url(${placeholderUrl(image.objectKey)})`,
              backgroundSize: "cover",
            }}
            className="w-full bg-surface-strong object-cover"
          />
          {burst > 0 && (
            <span
              key={burst}
              className="pointer-events-none absolute inset-0 grid place-items-center"
            >
              <Heart className="animate-heart-burst size-20 fill-white text-white drop-shadow-lg" />
            </span>
          )}
        </div>
      ) : null}

      {clipSrc && burst > 0 && (
        <span
          key={`v-${burst}`}
          className="pointer-events-none relative -mt-24 grid place-items-center"
        >
          <Heart className="animate-heart-burst size-20 fill-white text-white drop-shadow-lg" />
        </span>
      )}

      <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-5">
        <button
          key={liked ? "liked" : "unliked"}
          onClick={likeWithBurst}
          aria-pressed={liked}
          aria-label="Like"
          className="press flex items-center gap-2"
        >
          <Heart
            className={cn("size-5", liked ? "animate-pop fill-live text-live" : "text-foreground")}
          />
          <span className="text-sm text-foreground">{compact.format(likeCount)}</span>
        </button>
        {commentsEnabled && (
          <button
            aria-label="Comment"
            onClick={openCardComments}
            className="press flex items-center gap-2"
          >
            <MessageCircle className="size-5 text-foreground" />
            <span className="text-sm text-foreground">{compact.format(totalComments)}</span>
          </button>
        )}
        {sharingEnabled && (
          <button
            aria-label="Share"
            onClick={() => {
              setSharing(true);
              track?.("video_share", post.id, { authorId: author.id });
            }}
            className="flex items-center gap-2"
          >
            <Share2 className="size-5 text-foreground" />
            <span className="text-sm text-foreground">{compact.format(post.metrics.shares)}</span>
          </button>
        )}
        <button
          key={saved ? "saved" : "unsaved"}
          onClick={toggleSavePost}
          aria-pressed={saved}
          aria-label="Save"
          className="press"
        >
          <Bookmark
            className={cn(
              "size-5",
              saved ? "animate-pop fill-brand text-brand" : "text-foreground",
            )}
          />
        </button>
      </div>

      {commentsEnabled && preview && (
        <div className="px-3 pb-3 sm:px-5">
          <button
            onClick={openCardComments}
            aria-label="Open comments"
            className="flex w-full items-center gap-2 rounded-xl px-1 py-1.5 text-left hover:bg-secondary"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-foreground">
                {preview.user.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                <span className="font-semibold">{preview.user}</span>{" "}
                <span className="text-muted-foreground">{preview.text}</span>
              </span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-muted-foreground">
              {compact.format(totalComments)}
            </span>
          </button>
        </div>
      )}

      <ShareSheet
        open={sharing}
        onClose={() => setSharing(false)}
        url={shareUrl}
        message={`${author.displayName} on WIZZ: ${post.caption}`}
      />
      {reportTarget && (
        <ReportDialog open onClose={() => setReportTarget(null)} target={reportTarget} />
      )}
    </article>
  );
}
