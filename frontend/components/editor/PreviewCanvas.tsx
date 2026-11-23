import { useEffect, useRef } from "react";
import { useEditorStore } from "@/frontend/store/editorStore";
import {
  resolvePlayhead,
  adjustToCssFilter,
  type TextLayer,
  type StickerLayer,
} from "@/frontend/lib/editorTypes";
import { cn } from "@/lib/utils";

type DragInfo = { kind: "text" | "sticker"; id: string; ox: number; oy: number };

export function PreviewCanvas({ className }: { className?: string }) {
  const { project, playhead, playing, selectedClipId } = useEditorStore();
  const { clips, textLayers, stickers, globalFilter, globalAdjust, bgColor } = project;
  const updateClip = useEditorStore((s) => s.updateClip);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<DragInfo | null>(null);

  const updateTextLayer = useEditorStore((s) => s.updateTextLayer);
  const updateSticker = useEditorStore((s) => s.updateSticker);

  const resolved = clips.length ? resolvePlayhead(clips, playhead) : null;
  const activeClip = resolved ? clips[resolved.clipIndex] : null;
  const selectedClip = clips.find((c) => c.id === selectedClipId);

  const clipFilter = activeClip
    ? adjustToCssFilter(activeClip.adjust, activeClip.filter)
    : adjustToCssFilter(globalAdjust, globalFilter);

  /* ── Play / pause ── */
  useEffect(() => {
    const v = videoRef.current;
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      v?.pause();
      return;
    }

    v?.play().catch(() => undefined);

    let last = performance.now();
    function tick(now: number) {
      const dt = (now - last) / 1000;
      last = now;
      useEditorStore.getState().setPlayhead(useEditorStore.getState().playhead + dt);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing]);

  /* ── Seek when scrubbing (not playing) ── */
  useEffect(() => {
    if (playing) return;
    const v = videoRef.current;
    if (!v) return;
    const target = resolved?.clipTime ?? 0;
    if (Math.abs(v.currentTime - target) > 0.08) v.currentTime = target;
  }, [playhead, playing, resolved?.clipTime]);

  /* ── Pointer drag handlers for overlay layers ── */
  function startDrag(
    e: React.PointerEvent,
    kind: "text" | "sticker",
    id: string,
    x: number,
    y: number,
  ) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      kind,
      id,
      ox: e.clientX - rect.left - x * rect.width,
      oy: e.clientY - rect.top - y * rect.height,
    };
  }

  function moveDrag(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(
      0.02,
      Math.min(0.98, (e.clientX - rect.left - dragRef.current.ox) / rect.width),
    );
    const y = Math.max(
      0.02,
      Math.min(0.98, (e.clientY - rect.top - dragRef.current.oy) / rect.height),
    );
    if (dragRef.current.kind === "text") updateTextLayer(dragRef.current.id, { x, y });
    else updateSticker(dragRef.current.id, { x, y });
  }

  const isTransparent = bgColor === "transparent";

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden rounded-2xl",
        selectedClip && "ring-[3px] ring-white",
        className,
      )}
      style={{
        aspectRatio: "9/16",
        backgroundColor: isTransparent ? undefined : bgColor || "#000000",
        backgroundImage: isTransparent
          ? "repeating-conic-gradient(#444 0% 25%, #222 0% 50%) 0 0 / 20px 20px"
          : undefined,
      }}
      onPointerMove={moveDrag}
      onPointerUp={() => {
        dragRef.current = null;
      }}
    >
      {/* Video / image layer */}
      {activeClip ? (
        <video
          key={activeClip.src}
          ref={videoRef}
          src={activeClip.src}
          className="size-full object-cover"
          style={{ filter: clipFilter, opacity: activeClip.opacity }}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            console.log("[preview] loadedmetadata OK src:", v.src.slice(-60), "dur:", v.duration);
            // If the probe returned a fallback duration (60 s placeholder), fix
            // the clip with the real duration now that the browser can read it.
            if (activeClip && Number.isFinite(v.duration) && v.duration > 0) {
              const realDur = v.duration;
              if (Math.abs(activeClip.nativeDuration - realDur) > 0.5) {
                updateClip(activeClip.id, {
                  nativeDuration: realDur,
                  trimEnd: Math.min(activeClip.trimEnd, realDur),
                });
              }
            }
            // Seek to playhead after metadata loads (currentTime=0 by default)
            const target = resolved?.clipTime ?? 0;
            if (target > 0.05) v.currentTime = target;
            if (playing) v.play().catch(() => undefined);
          }}
          onError={(e) => {
            const v = e.currentTarget;
            console.log(
              "[preview] ERROR src:",
              v.src.slice(-60),
              "code:",
              v.error?.code,
              "msg:",
              v.error?.message,
            );
          }}
        />
      ) : (
        <div className="grid size-full place-items-center">
          <p className="text-[11px] text-white/30">No clip</p>
        </div>
      )}

      {/* Vignette overlay */}
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
        fontSize: "clamp(24px, 8vw, 48px)",
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
