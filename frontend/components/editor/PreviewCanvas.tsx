import { useEffect, useRef, useCallback } from "react";
import { useEditorStore } from "@/frontend/store/editorStore";
import {
  resolvePlayhead,
  adjustToCssFilter,
  type TextLayer,
  type StickerLayer,
} from "@/frontend/lib/editorTypes";
import { cn } from "@/lib/utils";

/* ─── Single hidden <video> element kept per clip src ──────────────────── */
const videoCache = new Map<string, HTMLVideoElement>();

function getOrCreateVideo(src: string): HTMLVideoElement {
  if (videoCache.has(src)) return videoCache.get(src)!;
  const v = document.createElement("video");
  v.src = src;
  v.preload = "auto";
  v.muted = true;
  v.playsInline = true;
  v.style.display = "none";
  document.body.appendChild(v);
  videoCache.set(src, v);
  return v;
}

/* ─── Layer drag state ──────────────────────────────────────────────────── */
type DragInfo = {
  kind: "text" | "sticker";
  id: string;
  ox: number; oy: number;
};

export function PreviewCanvas({ className }: { className?: string }) {
  const { project, playhead, playing, selectedClipId, setPlayhead } = useEditorStore();
  const { clips, textLayers, stickers, globalFilter, globalAdjust } = project;

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<DragInfo | null>(null);

  const updateTextLayer = useEditorStore((s) => s.updateTextLayer);
  const updateSticker = useEditorStore((s) => s.updateSticker);

  /* ── Resolve which clip is active and seek the video ── */
  const syncVideo = useCallback(() => {
    if (!clips.length) { videoRef.current = null; return; }
    const resolved = resolvePlayhead(clips, playhead);
    if (!resolved) return;
    const clip = clips[resolved.clipIndex];
    if (!clip) return;

    const vid = getOrCreateVideo(clip.src);
    if (videoRef.current !== vid) {
      if (videoRef.current) videoRef.current.pause();
      videoRef.current = vid;
    }
    const target = resolved.clipTime;
    if (Math.abs(vid.currentTime - target) > 0.08) {
      vid.currentTime = target;
    }
  }, [clips, playhead]);

  /* ── Playback loop ── */
  useEffect(() => {
    if (playing) {
      videoRef.current?.play().catch(() => undefined);
      let last = performance.now();
      function tick(now: number) {
        const dt = (now - last) / 1000;
        last = now;
        useEditorStore.getState().setPlayhead(playhead + dt);
        rafRef.current = requestAnimationFrame(tick);
      }
      rafRef.current = requestAnimationFrame(tick);
    } else {
      videoRef.current?.pause();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => { syncVideo(); }, [syncVideo]);

  /* ── Pointer handlers for layer drag ── */
  function startDrag(e: React.PointerEvent, kind: "text" | "sticker", id: string, x: number, y: number) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      kind, id,
      ox: e.clientX - rect.left - x * rect.width,
      oy: e.clientY - rect.top - y * rect.height,
    };
  }

  function moveDrag(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left - dragRef.current.ox) / rect.width));
    const y = Math.max(0.02, Math.min(0.98, (e.clientY - rect.top - dragRef.current.oy) / rect.height));
    if (dragRef.current.kind === "text") {
      updateTextLayer(dragRef.current.id, { x, y });
    } else {
      updateSticker(dragRef.current.id, { x, y });
    }
  }

  const cssFilter = adjustToCssFilter(globalAdjust, globalFilter);
  const selectedClip = clips.find((c) => c.id === selectedClipId);

  /* ── Active clip for preview (video or placeholder) ── */
  const resolved = clips.length ? resolvePlayhead(clips, playhead) : null;
  const activeClip = resolved ? clips[resolved.clipIndex] : null;
  const clipFilter = activeClip
    ? adjustToCssFilter(activeClip.adjust, activeClip.filter)
    : cssFilter;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden rounded-2xl bg-black",
        selectedClip && "ring-[3px] ring-white",
        className,
      )}
      style={{ aspectRatio: "9/16" }}
      onPointerMove={moveDrag}
      onPointerUp={() => { dragRef.current = null; }}
    >
      {/* Video layer */}
      {activeClip ? (
        <video
          key={activeClip.src}
          src={activeClip.src}
          className="size-full object-cover"
          style={{ filter: clipFilter, opacity: activeClip.opacity }}
          muted
          playsInline
          ref={(el) => {
            if (el) {
              videoRef.current = el;
              el.currentTime = resolved?.clipTime ?? 0;
            }
          }}
        />
      ) : (
        <div className="grid size-full place-items-center bg-black">
          <p className="text-xs text-white/40">No clip</p>
        </div>
      )}

      {/* Vignette */}
      {(globalAdjust.vignette > 0 || (activeClip?.adjust.vignette ?? 0) > 0) && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${
              ((activeClip?.adjust.vignette ?? 0) || globalAdjust.vignette) * 0.008
            }) 100%)`,
          }}
        />
      )}

      {/* Text layers */}
      {textLayers
        .filter((l) => playhead >= l.startTime && playhead < l.endTime)
        .map((l) => (
          <TextLayerNode
            key={l.id}
            layer={l}
            onPointerDown={(e) => startDrag(e, "text", l.id, l.x, l.y)}
          />
        ))}

      {/* Sticker layers */}
      {stickers
        .filter((sk) => playhead >= sk.startTime && playhead < sk.endTime)
        .map((sk) => (
          <StickerNode
            key={sk.id}
            layer={sk}
            onPointerDown={(e) => startDrag(e, "sticker", sk.id, sk.x, sk.y)}
          />
        ))}
    </div>
  );
}

function TextLayerNode({
  layer,
  onPointerDown,
}: {
  layer: TextLayer;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const bgStyle =
    layer.bg === "dark"
      ? "rgba(0,0,0,0.55)"
      : layer.bg === "light"
        ? "rgba(255,255,255,0.65)"
        : "transparent";
  return (
    <span
      style={{
        position: "absolute",
        left: `${layer.x * 100}%`,
        top: `${layer.y * 100}%`,
        transform: `translate(-50%,-50%) rotate(${layer.rotation}deg) scale(${layer.scale})`,
        fontSize: `${layer.fontSize}px`,
        fontWeight: layer.bold ? "bold" : "normal",
        fontStyle: layer.italic ? "italic" : "normal",
        color: layer.color,
        backgroundColor: bgStyle,
        padding: "2px 8px",
        borderRadius: "6px",
        whiteSpace: "nowrap",
        touchAction: "none",
        userSelect: "none",
        cursor: "grab",
      }}
      onPointerDown={onPointerDown}
    >
      {layer.text}
    </span>
  );
}

function StickerNode({
  layer,
  onPointerDown,
}: {
  layer: StickerLayer;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <span
      style={{
        position: "absolute",
        left: `${layer.x * 100}%`,
        top: `${layer.y * 100}%`,
        transform: `translate(-50%,-50%) rotate(${layer.rotation}deg) scale(${layer.scale})`,
        fontSize: `clamp(24px, 8vw, 48px)`,
        lineHeight: 1,
        touchAction: "none",
        userSelect: "none",
        cursor: "grab",
      }}
      onPointerDown={onPointerDown}
    >
      {layer.emoji}
    </span>
  );
}
