import { useCallback, useEffect, useRef, useState } from "react";
import { publicUrl } from "@/frontend/lib/native";
import { Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  Bookmark,
  Check,
  Heart,
  Loader2,
  MessageCircle,
  Music,
  Pause,
  PhoneOff,
  Play,
  Plus,
  RotateCcw,
  Send,
  Share2,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { imageUrl, videoQualityUrl } from "@/backend/domain/media";
import type { ShortItem } from "@/backend/api/sections.functions";
import { shortsQueryOptions } from "@/frontend/queries/sections";
import { useSession } from "@/frontend/hooks/useSession";
import { useAuthGate } from "@/frontend/hooks/useAuthGate";
import { useMyProfile } from "@/frontend/hooks/useMyProfile";
import { useFollowList, useFollowState } from "@/frontend/hooks/usePublicProfile";
import { useDemoComments } from "@/frontend/hooks/useDemoComments";
import { useComments } from "@/frontend/components/comments/CommentsContext";
import { useBlend, type BlendRemoteState } from "@/frontend/hooks/useBlend";
import { useAdaptiveQuality } from "@/frontend/hooks/useAdaptiveQuality";
import { BlendSheet } from "@/frontend/components/shorts/BlendSheet";
import { MusicSheet } from "@/frontend/components/shorts/MusicSheet";
import { ShareSheet } from "@/frontend/components/overlays/ShareSheet";
import { cn } from "@/lib/utils";
import { BottomNav } from "@/frontend/components/home/BottomNav";

const compact = new Intl.NumberFormat("en", { notation: "compact" });
const DOUBLE_TAP_MS = 280;
const LONG_PRESS_MS = 500;
const FOLLOWS_KEY = "wizz:short-follows";
const MUTE_KEY = "wizz:muted";
const VIEW_COUNT_KEY = "wizz:short-views";
const PRELOAD_AHEAD = 1;
const UNLOAD_THRESHOLD = 2;
const VIEW_COUNT_DELAY = 2500;
const WHEEL_DEBOUNCE_MS = 300;

function loadFollows(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FOLLOWS_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "true";
  } catch {
    return true;
  }
}

function saveMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, String(muted));
  } catch {
    // ignore
  }
}

function loadViewCounts(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(VIEW_COUNT_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Seed/demo shorts use fake author ids ("u-riko") that aren't real profiles. */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/*  ShortCard                                                          */
/* ------------------------------------------------------------------ */

function ShortCard({
  item,
  index,
  isActive,
  viewerId,
  muted,
  onToggleMute,
  onOpenComments,
  onOpenProfile,
  onOpenShare,
  onOpenMusic,
  onBlend,
  onCountView,
  registerVideo,
}: {
  item: ShortItem;
  index: number;
  isActive: boolean;
  viewerId: string | null;
  muted: boolean;
  onToggleMute: () => void;
  onOpenComments: (id: string) => void;
  onOpenProfile: (authorId: string, username: string) => void;
  onOpenShare: (url: string, message: string) => void;
  onOpenMusic: (soundtrack: string) => void;
  onBlend: () => void;
  onCountView: (id: string) => void;
  registerVideo: (id: string, video: HTMLVideoElement | null) => void;
}) {
  const [burst, setBurst] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(() => {
    try {
      const ids = JSON.parse(localStorage.getItem("wizz:saved-shorts") ?? "[]") as string[];
      return ids.includes(item.short.id);
    } catch {
      return false;
    }
  });
  const requireAuth = useAuthGate();
  const { openComments } = useComments();
  const demoComments = useDemoComments(item.short.id, "you");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tapTimer = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const viewCounted = useRef(false);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const scrubbing = useRef(false);

  // Adaptive bitrate
  const abr = useAdaptiveQuality(item.short.video.objectKey, isActive);
  const qualitySrc = videoQualityUrl(item.short.video.objectKey, abr.quality);
  const lastQualityRef = useRef(abr.quality);

  // Swap video source when ABR picks a different quality
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (abr.quality === lastQualityRef.current) return;
    lastQualityRef.current = abr.quality;
    const wasPlaying = !v.paused;
    const pos = v.currentTime;
    v.src = qualitySrc;
    v.currentTime = pos;
    if (wasPlaying) void v.play().catch(() => undefined);
  }, [abr.quality, qualitySrc]);

  // Follow state
  const authorId = item.short.authorId;
  const realAuthor = isUuid(authorId) && viewerId !== authorId;
  const { isFollowing: followedInDb, toggle } = useFollowState(
    realAuthor ? viewerId : null,
    realAuthor ? authorId : null,
  );
  const [following, setFollowing] = useState(
    () => loadFollows().includes(authorId) || followedInDb,
  );

  useEffect(() => {
    if (realAuthor) setFollowing(followedInDb);
  }, [realAuthor, followedInDb]);

  // Likes — local state for seed shorts (non-UUID IDs can't use post_likes table)
  const [likeCount, setLikeCount] = useState(item.short.metrics.likes);
  const toggleLike = useCallback(() => {
    if (!requireAuth()) return;
    setLiked((prev) => {
      const next = !prev;
      setLikeCount((c) => c + (next ? 1 : -1));
      return next;
    });
  }, [requireAuth]);

  // Saved/bookmark — localStorage for seed shorts
  const SAVED_KEY = "wizz:saved-shorts";
  const [savedCount, setSavedCount] = useState(item.short.metrics.saves);
  const toggleSave = useCallback(() => {
    if (!requireAuth()) return;
    setSaved((prev) => {
      const next = !prev;
      setSavedCount((c) => c + (next ? 1 : -1));
      try {
        const ids = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as string[];
        const nextIds = next
          ? [...new Set([...ids, item.short.id])]
          : ids.filter((id) => id !== item.short.id);
        localStorage.setItem(SAVED_KEY, JSON.stringify(nextIds));
      } catch {
        // ignore
      }
      return next;
    });
  }, [requireAuth, item.short.id]);

  // Register video element for parent control
  useEffect(() => {
    registerVideo(item.short.id, videoRef.current);
    return () => registerVideo(item.short.id, null);
  }, [item.short.id, registerVideo]);

  // Play/pause based on active state
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isActive) {
      v.play().catch(() => undefined);
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
      // Reset to start if far from active
      if (Math.abs(index - 0) > UNLOAD_THRESHOLD) {
        v.currentTime = 0;
      }
    }
  }, [isActive, index]);

  // Global mute
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted;
  }, [muted]);

  // View counting — once per user per video after ~2.5s
  useEffect(() => {
    if (!isActive || !viewerId || viewCounted.current) return;
    const timer = setTimeout(() => {
      viewCounted.current = true;
      onCountView(item.short.id);
    }, VIEW_COUNT_DELAY);
    return () => clearTimeout(timer);
  }, [isActive, viewerId, item.short.id, onCountView]);

  // Pause when comments sheet opens
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!openComments) {
      v.pause();
      setPaused(true);
    } else if (isActive) {
      v.play().catch(() => undefined);
      setPaused(false);
    }
  }, [openComments, isActive]);

  function toggleFollow() {
    if (!requireAuth()) return;
    if (realAuthor) {
      const next = !following;
      setFollowing(next);
      toggle.mutate(next, { onError: () => setFollowing(!next) });
      return;
    }
    setFollowing((v) => {
      const next = !v;
      try {
        const ids = loadFollows();
        localStorage.setItem(
          FOLLOWS_KEY,
          JSON.stringify(
            next ? [...new Set([...ids, authorId])] : ids.filter((id) => id !== authorId),
          ),
        );
      } catch {
        // ignore
      }
      return next;
    });
  }

  const shareUrl = typeof window !== "undefined" ? publicUrl(`/shorts`) : "";

  function handleTap() {
    if (tapTimer.current) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = null;
      if (!requireAuth()) return;
      if (!liked) toggleLike();
      setBurst((n) => n + 1);
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) {
        void v.play().catch(() => undefined);
        setPaused(false);
      } else {
        v.pause();
        setPaused(true);
      }
    }, DOUBLE_TAP_MS);
  }

  function handleLongPressStart() {
    longPressed.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      const v = videoRef.current;
      if (v && !v.paused) {
        v.pause();
        setPaused(true);
      }
    }, LONG_PRESS_MS);
  }

  function handleLongPressEnd() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (longPressed.current) {
      const v = videoRef.current;
      if (v && isActive && v.paused) {
        void v.play().catch(() => undefined);
        setPaused(false);
      }
    }
  }

  function handleScrub(e: React.MouseEvent<HTMLDivElement>) {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = frac * v.duration;
    setProgress(frac * 100);
  }

  function handleScrubStart(e: React.MouseEvent<HTMLDivElement>) {
    scrubbing.current = true;
    handleScrub(e);
  }

  function handleScrubMove(e: React.MouseEvent<HTMLDivElement>) {
    if (scrubbing.current) handleScrub(e);
  }

  function handleScrubEnd() {
    scrubbing.current = false;
  }

  function handleRetry() {
    setError(false);
    const v = videoRef.current;
    if (v) {
      v.load();
      if (isActive) void v.play().catch(() => undefined);
    }
  }

  const caption = item.short.caption;
  const isLongCaption = caption.length > 60;
  const displayCaption = expanded || !isLongCaption ? caption : caption.slice(0, 60) + "…";

  return (
    <section
      data-index={index}
      className="relative h-[100dvh] w-full snap-start snap-always overflow-hidden bg-media"
    >
      {/* Video */}
      <video
        ref={videoRef}
        src={isActive ? qualitySrc : ""}
        poster={isActive ? imageUrl(item.short.video.posterKey, "medium", 0.5625) : undefined}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        loop
        muted={muted}
        preload={isActive ? "auto" : "metadata"}
        onClick={handleTap}
        onMouseDown={handleLongPressStart}
        onMouseUp={handleLongPressEnd}
        onMouseLeave={handleLongPressEnd}
        onTouchStart={handleLongPressStart}
        onTouchEnd={handleLongPressEnd}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onError={() => setError(true)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration > 0 && !scrubbing.current) {
            setProgress((v.currentTime / v.duration) * 100);
          }
        }}
      />

      {/* Buffering spinner */}
      {buffering && isActive && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Loader2 className="size-10 animate-spin text-white/80" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/60">
          <button
            onClick={handleRetry}
            className="flex flex-col items-center gap-2 rounded-2xl bg-white/10 px-6 py-4 text-white backdrop-blur"
          >
            <RotateCcw className="size-6" />
            <span className="text-sm font-semibold">Tap to retry</span>
          </button>
        </div>
      )}

      {/* Paused indicator */}
      {paused && !buffering && !error && isActive && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="animate-scale-in grid size-16 place-items-center rounded-full bg-black/50 backdrop-blur">
            <Play className="size-7 translate-x-0.5 fill-white text-white" />
          </span>
        </div>
      )}

      {/* Double-tap heart burst */}
      {burst > 0 && (
        <span key={burst} className="pointer-events-none absolute inset-0 grid place-items-center">
          <Heart className="animate-heart-burst size-24 fill-white text-white drop-shadow-lg" />
        </span>
      )}

      {/* Bottom gradient scrim */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />

      {/* Right-side action column */}
      <div className="absolute bottom-24 right-3 z-10 flex flex-col items-center gap-5 sm:bottom-28 sm:right-5">
        {/* Creator avatar + follow */}
        <button
          onClick={() => onOpenProfile(authorId, item.authorUsername)}
          aria-label={`View ${item.authorName}'s profile`}
          className="relative mb-1"
        >
          <img
            src={imageUrl(item.authorAvatarKey, "thumbnail")}
            alt={item.authorName}
            className="size-12 rounded-full border-2 border-white object-cover"
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleFollow();
            }}
            aria-label={following ? "Unfollow" : "Follow"}
            className={cn(
              "absolute -bottom-2 left-1/2 grid size-5 -translate-x-1/2 place-items-center rounded-full",
              following ? "bg-white" : "bg-brand",
            )}
          >
            {following ? (
              <Check className="size-3 text-black" strokeWidth={3} />
            ) : (
              <Plus className="size-3 text-brand-foreground" />
            )}
          </button>
        </button>

        {/* Like */}
        <button
          aria-label="Like"
          aria-pressed={liked}
          onClick={toggleLike}
          className="flex flex-col items-center gap-1"
        >
          <Heart
            key={liked ? "liked" : "unliked"}
            className={cn("size-7", liked ? "animate-pop fill-live text-live" : "text-white")}
          />
          <span className="text-[11px] font-semibold text-white">{compact.format(likeCount)}</span>
        </button>

        {/* Comments */}
        <button
          aria-label="Comments"
          onClick={() => {
            if (!requireAuth()) return;
            onOpenComments(item.short.id);
          }}
          className="flex flex-col items-center gap-1"
        >
          <MessageCircle className="size-7 text-white" />
          <span className="text-[11px] font-semibold text-white">
            {compact.format(demoComments.total)}
          </span>
        </button>

        {/* Bookmark */}
        <button
          aria-label="Bookmark"
          aria-pressed={saved}
          onClick={toggleSave}
          className="flex flex-col items-center gap-1"
        >
          <Bookmark className={cn("size-7", saved ? "fill-brand text-brand" : "text-white")} />
          <span className="text-[11px] font-semibold text-white">{compact.format(savedCount)}</span>
        </button>

        {/* Blend / Watch together */}
        <button
          aria-label="Watch together"
          onClick={() => {
            if (!requireAuth()) return;
            onBlend();
          }}
          className="flex flex-col items-center gap-1"
        >
          <Users className="size-7 text-white" />
          <span className="text-[11px] font-semibold text-white">Blend</span>
        </button>

        {/* Share */}
        <button
          aria-label="Share"
          onClick={() => setSharing(true)}
          className="flex flex-col items-center gap-1"
        >
          <Share2 className="size-7 text-white" />
          <span className="text-[11px] font-semibold text-white">
            {compact.format(item.short.metrics.shares)}
          </span>
        </button>

        {/* Spinning music disc */}
        <button
          onClick={() => onOpenMusic(item.short.soundtrack)}
          aria-label="Soundtrack"
          className="mt-1"
        >
          <img
            src={imageUrl(item.authorAvatarKey, "thumbnail")}
            alt=""
            className="size-9 animate-[spin_3s_linear_infinite] rounded-full border-2 border-white/50 object-cover"
          />
        </button>
      </div>

      {/* Bottom-left info */}
      <div className="absolute bottom-20 left-0 right-16 z-10 px-4 sm:bottom-24 sm:px-6">
        <p className="text-base font-bold text-white">@{item.authorUsername}</p>
        <p className={cn("mt-1.5 text-sm text-white/95", !expanded && "line-clamp-2")}>
          {displayCaption}
        </p>
        {isLongCaption && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-0.5 text-xs font-semibold text-white/70"
          >
            {expanded ? "less" : "more"}
          </button>
        )}
        <button
          onClick={() => onOpenMusic(item.short.soundtrack)}
          className="mt-2 flex max-w-full items-center gap-1.5 rounded-full bg-black/35 py-1 pl-1.5 pr-3 text-left backdrop-blur"
        >
          <Music className="size-3.5 shrink-0 text-white" />
          <span className="truncate text-xs text-white/90">{item.short.soundtrack}</span>
        </button>
      </div>

      {/* Mute/unmute button */}
      <button
        onClick={onToggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        className="absolute right-3 top-16 z-10 grid size-8 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm"
      >
        {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>

      {/* Progress bar */}
      <div className="absolute inset-x-0 bottom-0 z-20 h-4">
        <div
          ref={progressRef}
          className="group relative h-full cursor-pointer"
          onMouseDown={handleScrubStart}
          onMouseMove={handleScrubMove}
          onMouseUp={handleScrubEnd}
          onMouseLeave={handleScrubEnd}
        >
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20 transition-all group-hover:h-1">
            <div
              className="h-full bg-white transition-[width] duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <ShareSheet
        open={sharing}
        onClose={() => setSharing(false)}
        url={shareUrl}
        message={`${item.authorName} on WIZZ: ${item.short.caption}`}
      />
      <MusicSheet open={musicOpen} onClose={() => setMusicOpen(false)} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton placeholder                                                */
/* ------------------------------------------------------------------ */

function ShortsSkeleton() {
  return (
    <div className="h-[100dvh] w-full animate-pulse bg-surface-strong">
      <div className="absolute bottom-24 right-5 flex flex-col items-center gap-5">
        <div className="size-12 rounded-full bg-white/10" />
        <div className="size-7 rounded-full bg-white/10" />
        <div className="size-7 rounded-full bg-white/10" />
        <div className="size-7 rounded-full bg-white/10" />
      </div>
      <div className="absolute bottom-24 left-4 space-y-2">
        <div className="h-4 w-24 rounded bg-white/10" />
        <div className="h-3 w-48 rounded bg-white/10" />
        <div className="h-3 w-32 rounded bg-white/10" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ShortsScreen                                                       */
/* ------------------------------------------------------------------ */

export function ShortsScreen() {
  const { data, isLoading } = useSuspenseQuery(shortsQueryOptions);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(loadMuted);
  const [blendOpen, setBlendOpen] = useState(false);
  const [musicOpen, setMusicOpen] = useState<string | null>(null);

  const { user, displayName } = useSession();
  const requireAuth = useAuthGate();
  const userId = user?.id ?? null;
  const { data: myProfile } = useMyProfile(userId);
  const { data: followers = [], isLoading: loadingFollowers } = useFollowList(
    myProfile?.id ?? null,
    "followers",
    userId,
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoEls = useRef(new Map<string, HTMLVideoElement>());
  const sectionEls = useRef(new Map<string, HTMLElement>());
  const wheelTimer = useRef<number | null>(null);
  const activeIndexRef = useRef(0);

  // Keep ref in sync
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const registerVideo = useCallback((id: string, video: HTMLVideoElement | null) => {
    if (video) videoEls.current.set(id, video);
    else videoEls.current.delete(id);
  }, []);

  // IntersectionObserver — detects which video is active
  useEffect(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number(entry.target.getAttribute("data-index"));
            if (!Number.isNaN(idx)) setActiveIndex(idx);
          }
        }
      },
      { root: container, threshold: 0.7 },
    );
    const sections = container.querySelectorAll("[data-index]");
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [data]);

  // Play/pause management — only active video plays
  useEffect(() => {
    const activeId = data[activeIndex]?.short.id;
    videoEls.current.forEach((video, id) => {
      if (id === activeId) {
        if (video.paused) video.play().catch(() => undefined);
      } else {
        if (!video.paused) video.pause();
        // Reset to start if far from active
        const idx = data.findIndex((d) => d.short.id === id);
        if (Math.abs(idx - activeIndex) > UNLOAD_THRESHOLD) {
          video.currentTime = 0;
        }
      }
    });
  }, [activeIndex, data]);

  // Preload management — only preload next 1, unload > 2 away
  useEffect(() => {
    videoEls.current.forEach((video, id) => {
      const idx = data.findIndex((d) => d.short.id === id);
      const distance = Math.abs(idx - activeIndex);
      if (distance <= PRELOAD_AHEAD + 1) {
        video.preload = "auto";
      } else if (distance > UNLOAD_THRESHOLD) {
        video.preload = "none";
      }
    });
  }, [activeIndex, data]);

  // Global mute
  useEffect(() => {
    videoEls.current.forEach((video) => {
      video.muted = muted;
    });
    saveMuted(muted);
  }, [muted]);

  // Pause when tab/app goes to background
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        videoEls.current.forEach((v) => v.pause());
      } else {
        const activeId = data[activeIndexRef.current]?.short.id ?? "";
        const activeVideo = videoEls.current.get(activeId);
        if (activeVideo) activeVideo.play().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [data]);

  // Keyboard navigation (desktop)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const next = Math.max(0, Math.min(data.length - 1, activeIndexRef.current + dir));
        const section = sectionEls.current.get(data[next]?.short.id ?? "");
        section?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [data]);

  // Mouse wheel navigation (desktop) — debounced
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(() => {
        const dir = e.deltaY > 0 ? 1 : -1;
        const next = Math.max(0, Math.min(data.length - 1, activeIndexRef.current + dir));
        const section = sectionEls.current.get(data[next]?.short.id ?? "");
        section?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, WHEEL_DEBOUNCE_MS);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel);
      if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
    };
  }, [data]);

  // Remember scroll position on unmount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const saved = sessionStorage.getItem("wizz:shorts-scroll");
    if (saved) {
      const idx = Number(saved);
      if (idx > 0 && idx < data.length) {
        const section = sectionEls.current.get(data[idx]?.short.id ?? "");
        section?.scrollIntoView({ block: "start" });
      }
    }
    return () => {
      sessionStorage.setItem("wizz:shorts-scroll", String(activeIndexRef.current));
    };
  }, [data]);

  // Blend (watch together)
  const applyRemote = useCallback(
    (s: BlendRemoteState) => {
      const el = videoEls.current.get(s.shortId);
      const section = sectionEls.current.get(s.shortId);
      const idx = data.findIndex((d) => d.short.id === s.shortId);
      if (idx >= 0) setActiveIndex(idx);
      if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
      if (el) {
        if (Math.abs(el.currentTime - s.time) > 2.5 && Number.isFinite(s.time)) {
          try {
            el.currentTime = s.time;
          } catch {
            // not ready
          }
        }
        if (s.playing && el.paused) void el.play().catch(() => undefined);
        if (!s.playing && !el.paused) el.pause();
      }
    },
    [data],
  );

  const {
    incoming,
    requesting,
    requestFailed,
    session,
    peerHere,
    reactions,
    sendInvite,
    replyInvite,
    leaveSession,
    cancelRequest,
    sendReaction,
  } = useBlend({ userId, displayName: displayName ?? "Someone", onRemoteState: applyRemote });

  // View counting
  const countView = useCallback((videoId: string) => {
    const views = loadViewCounts();
    if (!views[videoId]) {
      views[videoId] = true;
      try {
        localStorage.setItem(VIEW_COUNT_KEY, JSON.stringify(views));
      } catch {
        // ignore
      }
      // TODO: send to backend when view-count API exists
    }
  }, []);

  // Open comments sheet
  const { openComments } = useComments();
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const handleOpenComments = useCallback(
    (id: string) => {
      setCommentsFor(id);
      openComments(id);
    },
    [openComments],
  );

  // Open creator profile
  const handleOpenProfile = useCallback((authorId: string, username: string) => {
    if (isUuid(authorId)) {
      window.location.href = `/u/${username}`;
    }
  }, []);

  // Open share
  const [shareData, setShareData] = useState<{ url: string; message: string } | null>(null);
  const handleOpenShare = useCallback((url: string, message: string) => {
    setShareData({ url, message });
  }, []);

  // Open music
  const handleOpenMusic = useCallback((soundtrack: string) => {
    setMusicOpen(soundtrack);
  }, []);

  // Skeleton on first load
  if (isLoading) {
    return (
      <div className="h-[100dvh] w-full snap-y snap-mandatory overflow-y-auto bg-media">
        <ShortsSkeleton />
      </div>
    );
  }

  // Empty state
  if (data.length === 0) {
    return (
      <div className="grid h-[100dvh] place-items-center bg-media">
        <div className="text-center">
          <p className="text-lg font-bold text-foreground">No shorts yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Be the first to create a short video.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto h-[100dvh] w-full max-w-3xl overflow-hidden bg-media md:border-x md:border-border">
      <h1 className="sr-only">Shorts</h1>

      {/* Blend session indicator */}
      {session && (
        <div className="absolute inset-x-0 top-0 z-40 flex items-center gap-2 px-3 pt-safe">
          <div className="mx-auto mt-2 flex items-center gap-2 rounded-full bg-black/55 py-1.5 pl-3 pr-1.5 backdrop-blur">
            <span
              className={cn(
                "size-2 rounded-full",
                peerHere ? "animate-pulse bg-live" : "bg-white/50",
              )}
            />
            <span className="max-w-36 truncate text-xs font-bold text-white">
              Watching with {session.peerName}
            </span>
            <button
              aria-label="Send laugh"
              onClick={() => sendReaction("😂")}
              className="press rounded-full bg-white/15 px-2.5 py-1 text-sm"
            >
              😂
            </button>
            <button
              aria-label="Leave watch party"
              onClick={leaveSession}
              className="grid size-7 place-items-center rounded-full bg-white/15"
            >
              <PhoneOff className="size-3.5 text-white" />
            </button>
          </div>
        </div>
      )}

      {/* Reactions overlay */}
      {reactions.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center">
          {reactions.map((r) => (
            <span key={r.id} className="animate-heart-burst absolute text-6xl drop-shadow-lg">
              {r.emoji}
            </span>
          ))}
        </div>
      )}

      {/* Scroll container — CSS snap handles everything natively */}
      <div
        ref={containerRef}
        className="h-[100dvh] snap-y snap-mandatory overflow-y-auto overscroll-contain"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <style>{`
          .shorts-pager::-webkit-scrollbar { display: none; }
        `}</style>
        {data.map((item, index) => {
          const isActive = index === activeIndex;
          const shouldRender = Math.abs(index - activeIndex) <= 2;
          return (
            <div
              key={item.short.id}
              ref={(el) => {
                if (el) sectionEls.current.set(item.short.id, el);
                else sectionEls.current.delete(item.short.id);
              }}
              className="h-[100dvh] snap-start snap-always"
            >
              {shouldRender ? (
                <ShortCard
                  item={item}
                  index={index}
                  isActive={isActive}
                  viewerId={userId}
                  muted={muted}
                  onToggleMute={() => setMuted((m) => !m)}
                  onOpenComments={handleOpenComments}
                  onOpenProfile={handleOpenProfile}
                  onOpenShare={handleOpenShare}
                  onOpenMusic={handleOpenMusic}
                  onBlend={() => {
                    if (!requireAuth()) return;
                    setBlendOpen(true);
                  }}
                  onCountView={countView}
                  registerVideo={registerVideo}
                />
              ) : (
                <div className="h-full w-full bg-surface-strong" />
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom nav overlay */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30">
        <div className="pointer-events-auto">
          <BottomNav />
        </div>
      </div>

      {/* Blend sheet */}
      <BlendSheet
        open={blendOpen}
        onClose={() => setBlendOpen(false)}
        followers={followers}
        loadingFollowers={loadingFollowers}
        requesting={requesting}
        requestFailed={requestFailed}
        incoming={incoming ? { fromName: incoming.fromName } : null}
        onInvite={(toId, toName) => sendInvite(toId, toName, data[activeIndex]?.short.id ?? "")}
        onAccept={() => {
          void replyInvite(true).then(() => setBlendOpen(false));
        }}
        onDecline={() => void replyInvite(false)}
        onCancelRequest={() => {
          cancelRequest();
          setBlendOpen(false);
        }}
      />

      {/* Sign-in prompt */}
      {!session && !user && (
        <Link
          to="/auth"
          className="absolute bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-white/90 px-4 py-2 text-xs font-bold text-black"
        >
          Sign in to Blend with followers
        </Link>
      )}
    </div>
  );
}
