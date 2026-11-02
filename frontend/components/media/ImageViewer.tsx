import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Heart, X } from "lucide-react";
import { cn } from "@/frontend/lib/utils";
import { imageUrl } from "@/backend/domain/media";
import { pushOverlay } from "@/frontend/components/media/overlayStack";

type Point = { x: number; y: number };

const DOUBLE_TAP_MS = 280;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

/**
 * Full-screen photo viewer: horizontal paging across a multi-photo post,
 * pinch/double-tap zoom, double-tap to like, swipe down to close. Rendered as
 * a fixed overlay so the feed underneath keeps its scroll position intact.
 * Registers with the overlay stack so the hardware back button closes it.
 */
export function ImageViewer({
  images,
  startIndex = 0,
  liked,
  onToggleLike,
  onClose,
  alt = "",
  header,
}: {
  images: string[];
  startIndex?: number;
  liked?: boolean;
  onToggleLike?: () => void;
  onClose: () => void;
  alt?: string;
  header?: React.ReactNode;
}) {
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), images.length - 1));
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [dragY, setDragY] = useState(0);
  const [burst, setBurst] = useState(0);

  const pointers = useRef(new Map<number, Point>());
  const gestureStart = useRef<{ dist: number; zoom: number; y: number } | null>(null);
  const lastTap = useRef(0);
  const lastPan = useRef<Point | null>(null);

  // Overlay-aware hardware back + Escape on web.
  useEffect(() => pushOverlay(onClose), [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, images.length - 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, images.length]);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const toggleLike = useCallback(() => {
    if (!onToggleLike) return;
    onToggleLike();
    setBurst((n) => n + 1);
  }, [onToggleLike]);

  function distance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gestureStart.current = { dist: distance(a!, b!), zoom, y: e.clientY };
      lastPan.current = null;
    } else if (pointers.current.size === 1 && zoom <= 1) {
      gestureStart.current = { dist: 0, zoom, y: e.clientY };
      lastPan.current = { x: e.clientX, y: e.clientY };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && gestureStart.current) {
      const [a, b] = [...pointers.current.values()];
      const ratio = distance(a!, b!) / Math.max(gestureStart.current.dist, 1);
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, gestureStart.current.zoom * ratio));
      setZoom(next);
      if (next <= 1) setOffset({ x: 0, y: 0 });
      return;
    }

    // Single-finger: pan when zoomed, otherwise pull-down-to-dismiss.
    if (gestureStart.current && zoom > 1 && lastPan.current) {
      const dx = e.clientX - lastPan.current.x;
      const dy = e.clientY - lastPan.current.y;
      lastPan.current = { x: e.clientX, y: e.clientY };
      setOffset((o) => {
        const nx = o.x + dx;
        const ny = o.y + dy;
        // Rubber-band past the scaled edges.
        const maxX = ((zoom - 1) * window.innerWidth) / 2;
        const maxY = ((zoom - 1) * window.innerHeight) / 2;
        return {
          x: Math.min(maxX, Math.max(-maxX, nx)),
          y: Math.min(maxY, Math.max(-maxY, ny)),
        };
      });
    } else if (gestureStart.current && zoom <= 1) {
      const dy = e.clientY - gestureStart.current.y;
      setDragY(dy > 0 ? Math.min(dy, 240) : 0);
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gestureStart.current = null;
    lastPan.current = null;

    if (pointers.current.size === 0) {
      if (dragY > 96) {
        onClose();
        return;
      }
      setDragY(0);
    }

    // Double-tap: like when zoomed out, un-zoom when zoomed in.
    if (e.button !== 0 || pointers.current.size > 0) return;
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (zoom > 1) resetZoom();
      else toggleLike();
      return;
    }
    lastTap.current = now;
  }

  const hasMultiple = images.length > 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Photo viewer"}
      className="fixed inset-0 z-[70] flex flex-col bg-black/95"
      style={{ transform: `translateY(${dragY}px)`, opacity: 1 - Math.min(dragY / 400, 0.6) }}
    >
      <header className="relative z-10 flex items-center gap-2 px-3 pt-safe pb-2">
        <button
          onClick={onClose}
          aria-label="Close photo viewer"
          className="rounded-full p-2 text-white/90 hover:bg-white/10"
        >
          <X className="size-6" />
        </button>
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
          {header ?? `${Math.min(index + 1, images.length)} / ${images.length}`}
        </div>
        {onToggleLike && (
          <button
            onClick={toggleLike}
            aria-label="Like photo"
            aria-pressed={liked}
            className="rounded-full p-2 text-white/90 hover:bg-white/10"
          >
            <Heart className={cn("size-6", liked && "fill-red-500 text-red-500")} />
          </button>
        )}
        {hasMultiple && (
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold text-white">
            {index + 1}/{images.length}
          </span>
        )}
      </header>

      <div
        className="relative flex-1 touch-none overflow-hidden select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => {
          if (zoom > 1) setZoom((z) => Math.max(1, z - e.deltaY * 0.002));
        }}
      >
        <div
          className="flex h-full transition-transform duration-200"
          style={{
            transform: `translate3d(calc(${-index * 100}% + ${offset.x}px), ${offset.y}px, 0) scale(${zoom})`,
            width: `${images.length * 100}%`,
          }}
        >
          {images.map((src, i) => (
            <div key={`${src}-${i}`} className="grid h-full flex-1 place-items-center">
              <img
                src={src}
                alt={alt}
                draggable={false}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ))}
        </div>

        {burst > 0 && (
          <span
            key={burst}
            className="pointer-events-none absolute inset-0 grid place-items-center"
          >
            <Heart className="animate-heart-burst size-24 fill-white text-white drop-shadow-lg" />
          </span>
        )}

        {hasMultiple && (
          <>
            {index > 0 && (
              <button
                aria-label="Previous photo"
                onClick={() => {
                  setIndex((i) => i - 1);
                  resetZoom();
                }}
                className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white/90 hover:bg-black/60"
              >
                <ChevronLeft className="size-6" />
              </button>
            )}
            {index < images.length - 1 && (
              <button
                aria-label="Next photo"
                onClick={() => {
                  setIndex((i) => i + 1);
                  resetZoom();
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white/90 hover:bg-black/60"
              >
                <ChevronRight className="size-6" />
              </button>
            )}
          </>
        )}
      </div>

      {hasMultiple && (
        <div className="flex justify-center gap-1.5 pb-4 pt-3">
          {images.map((src, i) => (
            <button
              key={`dot-${src}-${i}`}
              aria-label={`Go to photo ${i + 1}`}
              onClick={() => {
                setIndex(i);
                resetZoom();
              }}
              className={cn(
                "size-2 rounded-full transition-colors",
                i === index ? "bg-white" : "bg-white/30",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
