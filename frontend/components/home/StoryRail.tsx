import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  MessageCircle,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { imageUrl } from "@/backend/domain/media";
import type { StoryItem } from "@/backend/services/feedService";
import type { Creator } from "@/backend/domain/types";
import { openCreate } from "@/frontend/components/home/nav-items";
import { pushOverlay } from "@/frontend/components/media/overlayStack";
import { useSession } from "@/frontend/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Props {
  currentUser: Creator;
  currentUserAvatar?: string | null | undefined;
  currentUserUsername?: string | undefined;
  stories: StoryItem[];
  /** Fired after the viewer deletes their own story so the rail refetches. */
  onStoryDeleted?: () => void;
}

/** Story duration matches the Instagram/Snap convention: 5s per photo. */
const STORY_MS = 5000;

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function StoryRail({
  currentUser,
  currentUserAvatar,
  currentUserUsername,
  stories,
  onStoryDeleted,
}: Props) {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [active, setActive] = useState<number | null>(null);
  const [seenLocal, setSeenLocal] = useState<Set<string>>(new Set());
  const [deletedLocal, setDeletedLocal] = useState<Set<string>>(new Set());
  const [hold, setHold] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [viewerCount, setViewerCount] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const holdRef = useRef(false);

  // Deleted stories vanish from the rail immediately; the server row is gone
  // for everyone via the owner delete, so no refetch (which would reset feed
  // pagination) is needed.
  const visibleStories = stories.filter((s) => !deletedLocal.has(s.id));

  // Group by author — one circle per person (Instagram-style).
  // The rail shows a single avatar per author; tapping it opens at that
  // author's first story and the viewer advances through all stories linearly.
  const authorOrder: string[] = [];
  const authorFirstIndex: Record<string, number> = {};
  for (let i = 0; i < visibleStories.length; i++) {
    const aid = visibleStories[i]!.author.id;
    if (!(aid in authorFirstIndex)) {
      authorFirstIndex[aid] = i;
      authorOrder.push(aid);
    }
  }

  const story = active === null ? null : (visibleStories[active] ?? null);
  const isOwner = Boolean(story && userId && story.author.id === userId);

  // Local seen overlay: the server row lands asynchronously, but the ring must
  // gray out the moment the story opens.
  const isViewed = (item: StoryItem) => item.viewed || seenLocal.has(item.id);

  const markSeen = useCallback(
    (item: StoryItem) => {
      if (!userId || seenLocal.has(item.id)) return;
      setSeenLocal((prev) => new Set(prev).add(item.id));
      // Fire-and-forget: RLS pins viewer_id to auth.uid(); a missing table
      // (migration not applied) must never break the viewer.
      void supabase
        .from("story_views")
        .upsert({ story_id: item.id, viewer_id: userId })
        .then(
          () => undefined,
          () => undefined,
        );
    },
    [seenLocal, userId],
  );

  useEffect(() => {
    setActive(null);
    setSeenLocal(new Set());
  }, [stories]);

  // Overlay-aware hardware back: closing the viewer must not also pop the route.
  useEffect(() => {
    if (active === null) return;
    return pushOverlay(() => setActive(null));
  }, [active]);

  const close = useCallback(() => setActive(null), []);

  const goNext = useCallback(() => {
    setActive((index) => {
      if (index === null) return null;
      const next = index + 1;
      if (next >= visibleStories.length) return null; // ran out → close
      const target = visibleStories[next];
      if (target) markSeen(target);
      return next;
    });
  }, [markSeen, visibleStories]);

  const goPrev = useCallback(() => {
    setActive((index) => (index === null ? null : Math.max(0, index - 1)));
    setProgress(0);
  }, []);

  // Mark the opened story as viewed (server + local ring state).
  useEffect(() => {
    if (story) markSeen(story);
    setProgress(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  // Owner-only viewer count.
  useEffect(() => {
    setViewerCount(null);
    if (!story || !isOwner) return;
    void supabase
      .from("story_views")
      .select("story_id", { count: "exact", head: true })
      .eq("story_id", story.id)
      .then(
        ({ count }) => setViewerCount(count ?? 0),
        () => setViewerCount(null),
      );
  }, [story, isOwner]);

  // Auto-advance: time-driven for photos, media-driven for videos. Paused
  // while holding, while the tab is hidden, and while the dialog is closed.
  useEffect(() => {
    if (active === null || !story || hold) return;
    const isVideo = story.mediaType === "video";
    if (isVideo) return; // progress follows the element's own clock below

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (!holdRef.current) {
        setProgress((p) => Math.min(1, p + dt / STORY_MS));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, story, hold]);

  // Photo finished → advance.
  useEffect(() => {
    if (story?.mediaType === "text" || story?.mediaType === "image") {
      if (progress >= 1) goNext();
    }
  }, [progress, story, goNext]);

  // Hold anywhere on the media pauses time + playback.
  const startHold = () => {
    holdRef.current = true;
    setHold(true);
    videoRef.current?.pause();
  };
  const endHold = () => {
    holdRef.current = false;
    setHold(false);
    if (story?.mediaType === "video") void videoRef.current?.play()?.catch(() => undefined);
  };

  // Escape/arrows + body scroll lock while open.
  useEffect(() => {
    if (!story) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") goPrev();
      if (event.key === "ArrowRight") goNext();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [story, close, goNext, goPrev]);

  const deleteOwnStory = async () => {
    if (!story || !isOwner) return;
    const { error } = await supabase.from("posts").delete().eq("id", story.id);
    if (error) return; // RLS/permission failure: keep the story, drop the prompt
    setDeletedLocal((prev) => new Set(prev).add(story.id));
    setConfirmDelete(false);
    setActive(null);
    onStoryDeleted?.();
  };

  return (
    <>
      <section aria-label="Stories" className="bg-background">
        <div className="rail flex gap-4 px-4 py-3">
          <button
            onClick={() => openCreate("story")}
            aria-label="Add to your story"
            className="press animate-fade-up flex w-16 shrink-0 flex-col items-center gap-1.5"
          >
            <span className="relative block rounded-full">
              <img
                src={currentUserAvatar || imageUrl(currentUser.avatarKey, "thumbnail")}
                alt="Your story"
                loading="lazy"
                className="size-[58px] rounded-full border-2 border-background object-cover opacity-90"
              />
              <span className="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full border-2 border-background bg-brand">
                <Plus className="size-3 text-white" strokeWidth={3} />
              </span>
            </span>
            <span className="w-full truncate text-center text-[11px] text-muted-foreground">
              You
            </span>
          </button>
          {authorOrder.map((authorId, railIdx) => {
            const firstIdx = authorFirstIndex[authorId]!;
            const firstItem = visibleStories[firstIdx]!;
            // Author ring is active (coloured) if any of their stories is unseen
            const authorStories = visibleStories.filter((s) => s.author.id === authorId);
            const allViewed = authorStories.every((s) => isViewed(s));
            return (
              <button
                key={authorId}
                onClick={() => {
                  setActive(firstIdx);
                  markSeen(firstItem);
                }}
                className="press animate-fade-up flex w-16 shrink-0 flex-col items-center gap-1.5"
                style={{ animationDelay: `${Math.min(railIdx, 8) * 50}ms` }}
              >
                <span
                  className={cn(
                    "group relative block rounded-full p-[2px]",
                    allViewed ? "bg-border" : "story-ring",
                  )}
                >
                  <img
                    src={imageUrl(firstItem.author.avatarKey, "thumbnail")}
                    alt={firstItem.author.displayName}
                    loading="lazy"
                    className="size-[58px] rounded-full border-2 border-background object-cover transition-transform duration-200 group-hover:scale-105 group-active:scale-95"
                  />
                  {!allViewed && (
                    <span className="absolute -right-0.5 -top-0.5 size-3.5 rounded-full border-2 border-background bg-live" />
                  )}
                </span>
                <span className="w-full truncate text-center text-[11px] text-muted-foreground">
                  {firstItem.author.username}
                </span>
              </button>
            );
          })}
        </div>
        <span className="sr-only">{currentUserUsername ?? currentUser.username}</span>
      </section>

      {story && active !== null && (
        <div
          role="dialog"
          aria-label={`${story.author.displayName}'s story`}
          className="fixed inset-0 z-[70] mx-auto flex max-w-md bg-black text-white"
        >
          {/* Segment progress: completed segments full, current one animating. */}
          <div className="absolute inset-x-0 top-0 z-20 flex gap-1.5 p-3">
            {visibleStories.map((item, i) => (
              <span key={item.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/35">
                <span
                  className="block h-full origin-left bg-white"
                  style={{
                    transform: `scaleX(${i < active ? 1 : i === active ? progress : 0})`,
                  }}
                />
              </span>
            ))}
          </div>

          <div className="absolute inset-x-0 top-3 z-20 flex items-center gap-2 px-3 pt-2">
            <img
              src={imageUrl(story.author.avatarKey, "thumbnail")}
              alt=""
              className="size-8 rounded-full object-cover"
            />
            <span className="text-sm font-bold">{story.author.displayName}</span>
            <span className="text-xs text-white/65">{relativeTime(story.createdAt)}</span>
            <span className="ml-auto flex items-center gap-1.5">
              {isOwner && viewerCount !== null && (
                <span
                  className="flex items-center gap-1 rounded-full bg-black/35 px-2 py-1 text-xs"
                  title="Viewers"
                >
                  <Eye className="size-3.5" /> {viewerCount}
                </span>
              )}
              {story.mediaType === "video" && (
                <button
                  type="button"
                  onClick={() => setMuted((m) => !m)}
                  aria-label={muted ? "Unmute story" : "Mute story"}
                  aria-pressed={muted}
                  className="grid size-8 place-items-center rounded-full bg-black/35"
                >
                  {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </button>
              )}
              <button
                type="button"
                onClick={close}
                aria-label="Close story"
                className="grid size-8 place-items-center rounded-full bg-black/35"
              >
                <X className="size-5" />
              </button>
            </span>
          </div>

          <button
            type="button"
            aria-label="Previous story"
            onClick={goPrev}
            className="absolute inset-y-0 left-0 z-10 w-1/3 cursor-w-resize"
          >
            <span className="sr-only">Previous story</span>
          </button>

          <div
            className="relative grid min-h-full w-full place-items-center overflow-hidden"
            onPointerDown={startHold}
            onPointerUp={endHold}
            onPointerCancel={endHold}
            onPointerLeave={endHold}
          >
            {story.mediaType === "image" && story.mediaUrl ? (
              <img
                src={story.mediaUrl}
                alt={story.caption || `${story.author.displayName}'s story`}
                className="size-full object-cover"
              />
            ) : story.mediaType === "video" && story.mediaUrl ? (
              <video
                key={story.id}
                ref={videoRef}
                src={story.mediaUrl}
                autoPlay
                playsInline
                muted={muted}
                className="size-full object-contain"
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  if (v.duration > 0) setProgress(v.currentTime / v.duration);
                }}
                onEnded={goNext}
              />
            ) : (
              <div
                className="grid size-full place-items-center p-10 text-center"
                style={{ backgroundColor: story.background }}
              >
                <p className="text-xl font-bold leading-relaxed">{story.caption}</p>
              </div>
            )}

            {hold && (
              <span className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="rounded-full bg-black/50 px-3 py-1 text-xs font-semibold">
                  Paused
                </span>
              </span>
            )}

            {story.mediaType !== "text" && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-5 pt-20">
                {story.overlays.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {story.overlays.map((overlay) => (
                      <span
                        key={overlay}
                        className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold backdrop-blur"
                      >
                        {overlay}
                      </span>
                    ))}
                  </div>
                )}
                {story.caption && <p className="text-sm leading-snug">{story.caption}</p>}
              </div>
            )}
          </div>

          {active < visibleStories.length - 1 && (
            <button
              type="button"
              aria-label="Next story"
              onClick={goNext}
              className="absolute inset-y-0 right-0 z-10 w-1/3 cursor-e-resize"
            >
              <ChevronRight className="absolute right-2 top-1/2 size-6 opacity-0" />
              <span className="sr-only">Next story</span>
            </button>
          )}
          {active > 0 && (
            <ChevronLeft className="pointer-events-none absolute left-2 top-1/2 z-10 size-6 opacity-0" />
          )}

          {/* Reply (opens the DM thread) + owner delete live above the tap zones. */}
          <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 p-4">
            <Link
              to="/messages"
              className="flex flex-1 items-center gap-2 rounded-full border border-white/30 bg-black/30 px-4 py-2 text-sm text-white/85 backdrop-blur"
              aria-label={`Reply to ${story.author.displayName}`}
            >
              <MessageCircle className="size-4" /> Reply…
            </Link>
            {isOwner && (
              <button
                type="button"
                onClick={() => setConfirmDelete((v) => !v)}
                aria-label="Delete your story"
                className="grid size-9 place-items-center rounded-full bg-black/30"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>

          {confirmDelete && isOwner && (
            <div className="absolute inset-x-0 bottom-16 z-30 mx-4 rounded-2xl bg-zinc-900 p-4 text-center shadow-raise">
              <p className="text-sm font-semibold">Delete this story?</p>
              <p className="mt-1 text-xs text-white/60">It disappears for everyone.</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 rounded-full bg-white/10 py-2 text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void deleteOwnStory()}
                  className="flex-1 rounded-full bg-live py-2 text-sm font-bold text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
