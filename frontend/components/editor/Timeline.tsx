import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, Volume2, VolumeX } from "lucide-react";
import { useEditorStore } from "@/frontend/store/editorStore";
import { projectDuration, clipProjectStart, type EditorClip } from "@/frontend/lib/editorTypes";
import { cn } from "@/lib/utils";

const TRACK_H = 52;
const RULER_H = 24;
const MIN_ZOOM = 20;
const MAX_ZOOM = 300;

function fmt(s: number) {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/* ─── Ruler ──────────────────────────────────────────────────────────── */
function TimeRuler({ zoom, offset }: { zoom: number; offset: number }) {
  const tickInterval = zoom < 40 ? 10 : zoom < 80 ? 5 : 1;
  const count = Math.ceil(120 / tickInterval) + 2;
  const startTick = Math.floor(offset / tickInterval / zoom) * tickInterval;
  return (
    <div
      className="relative overflow-hidden select-none"
      style={{ height: RULER_H, background: "#0d0d0d" }}
    >
      {Array.from({ length: count }, (_, i) => {
        const t = startTick + i * tickInterval;
        const x = t * zoom - offset;
        return (
          <span
            key={t}
            className="absolute top-0 text-[9px] text-white/40 tabular-nums"
            style={{ left: x, paddingLeft: 3 }}
          >
            {fmt(t)}
            <span className="absolute top-0 left-0 w-px bg-white/15" style={{ height: RULER_H }} />
          </span>
        );
      })}
    </div>
  );
}

/* ─── Single clip tile ────────────────────────────────────────────────── */
function ClipTile({
  clip,
  x,
  width,
  selected,
  onSelect,
  onTrimStart,
  onTrimEnd,
}: {
  clip: EditorClip;
  x: number;
  width: number;
  selected: boolean;
  onSelect: () => void;
  onTrimStart: (delta: number) => void;
  onTrimEnd: (delta: number) => void;
}) {
  const handleDrag = useCallback(
    (side: "start" | "end") => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      let lastX = e.clientX;
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - lastX;
        lastX = ev.clientX;
        if (side === "start") onTrimStart(dx);
        else onTrimEnd(dx);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [onTrimStart, onTrimEnd],
  );

  return (
    <div
      className={cn(
        "absolute top-0 flex h-full cursor-pointer items-center overflow-hidden rounded-lg",
        selected ? "ring-2 ring-white" : "ring-1 ring-white/20",
      )}
      style={{ left: x, width: Math.max(width, 20), height: TRACK_H, background: "#2C2C2E" }}
      onClick={onSelect}
    >
      {/* Thumbnails strip */}
      {clip.thumbnails.length > 0 ? (
        clip.thumbnails.map((url, i) => (
          <img
            key={i}
            src={url}
            alt=""
            draggable={false}
            className="h-full shrink-0 object-cover"
            style={{ width: Math.max(32, width / Math.max(1, clip.thumbnails.length)) }}
          />
        ))
      ) : (
        <div className="size-full bg-gradient-to-r from-white/5 to-white/10" />
      )}

      {/* Duration badge */}
      {selected && (
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-bold text-white tabular-nums">
          {(clip.trimEnd - clip.trimStart).toFixed(1)}s
        </span>
      )}

      {/* Trim handles */}
      {selected && (
        <>
          <div
            className="absolute left-0 top-0 h-full w-3 cursor-col-resize rounded-l-lg bg-white/80"
            onPointerDown={handleDrag("start")}
          />
          <div
            className="absolute right-0 top-0 h-full w-3 cursor-col-resize rounded-r-lg bg-white/80"
            onPointerDown={handleDrag("end")}
          />
        </>
      )}
    </div>
  );
}

/* ─── Sound track row ──────────────────────────────────────────────────── */
function SoundTrackRow({
  zoom,
  offset,
  onAdd,
}: {
  zoom: number;
  offset: number;
  onAdd: () => void;
}) {
  const { project } = useEditorStore();
  const sound = project.soundTrack;
  const totalDur = projectDuration(project.clips);
  const width = Math.min(sound?.duration ?? 0, totalDur) * zoom;

  return (
    <div className="relative flex items-center" style={{ height: 36 }}>
      {sound ? (
        <div
          className="absolute flex items-center overflow-hidden rounded-lg bg-[#1a3a1a]"
          style={{ left: -offset, width, height: 32 }}
        >
          {/* Waveform placeholder bars */}
          <div className="flex h-full items-center gap-0.5 px-2">
            {Array.from({ length: Math.max(2, Math.floor(width / 4)) }, (_, i) => (
              <div
                key={i}
                className="w-0.5 rounded-full bg-emerald-400/60"
                style={{ height: `${20 + Math.sin(i * 0.7) * 12}%` }}
              />
            ))}
          </div>
          <span className="absolute left-2 top-0.5 text-[9px] font-semibold text-emerald-300 truncate max-w-[80px]">
            {sound.title}
          </span>
        </div>
      ) : (
        <button
          onClick={onAdd}
          className="absolute flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 py-1.5 text-xs text-white/50"
          style={{ left: 0 }}
        >
          <span className="text-base">♪</span> Add sound
        </button>
      )}
    </div>
  );
}

/* ─── Timeline ─────────────────────────────────────────────────────────── */
export function Timeline({
  onAddClip,
  onAddSound,
  clipInputRef,
}: {
  onAddClip: () => void;
  onAddSound: () => void;
  clipInputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const { project, playhead, zoom, selectedClipId, setPlayhead, setZoom, selectClip, updateClip } =
    useEditorStore();
  const { clips } = project;

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(300);
  const [clipMuted, setClipMuted] = useState(false);

  // offset = how many pixels of timeline are left of center
  const offset = playhead * zoom;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setContainerW(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── Scrub on pointer drag ── */
  const scrubbing = useRef(false);
  function startScrub(e: React.PointerEvent) {
    scrubbing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const el = containerRef.current;
    if (!el) return;
    const cx = el.getBoundingClientRect().left + containerW / 2;
    setPlayhead((e.clientX - cx + offset) / zoom);
  }

  function moveScrub(e: React.PointerEvent) {
    if (!scrubbing.current) return;
    const el = containerRef.current;
    if (!el) return;
    const cx = el.getBoundingClientRect().left + containerW / 2;
    setPlayhead((e.clientX - cx + offset) / zoom);
  }

  /* ── Pinch to zoom ── */
  const lastPinchDist = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0]!.clientX - e.touches[1]!.clientX;
      const dy = e.touches[0]!.clientY - e.touches[1]!.clientY;
      lastPinchDist.current = Math.hypot(dx, dy);
    }
  }
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length !== 2 || lastPinchDist.current === null) return;
    const dx = e.touches[0]!.clientX - e.touches[1]!.clientX;
    const dy = e.touches[0]!.clientY - e.touches[1]!.clientY;
    const dist = Math.hypot(dx, dy);
    const factor = dist / lastPinchDist.current;
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor)));
    lastPinchDist.current = dist;
  }

  /* ── Trim handlers ── */
  function handleTrimStart(clipIdx: number, dxPx: number) {
    const clip = clips[clipIdx];
    if (!clip) return;
    const dSec = dxPx / zoom;
    const newStart = Math.max(0, Math.min(clip.trimStart + dSec, clip.trimEnd - 0.1));
    updateClip(clip.id, { trimStart: newStart });
  }
  function handleTrimEnd(clipIdx: number, dxPx: number) {
    const clip = clips[clipIdx];
    if (!clip) return;
    const dSec = dxPx / zoom;
    const newEnd = Math.min(
      clip.nativeDuration,
      Math.max(clip.trimEnd + dSec, clip.trimStart + 0.1),
    );
    updateClip(clip.id, { trimEnd: newEnd });
  }

  const totalDur = projectDuration(clips);
  const trackW = Math.max(containerW, totalDur * zoom + containerW);

  return (
    <div
      className="flex flex-col bg-black select-none"
      style={{ minHeight: RULER_H + TRACK_H + 80 }}
    >
      {/* Ruler + tracks container */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
        onPointerDown={startScrub}
        onPointerMove={moveScrub}
        onPointerUp={() => {
          scrubbing.current = false;
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
      >
        {/* Fixed playhead */}
        <div
          className="pointer-events-none absolute inset-y-0 z-30"
          style={{ left: containerW / 2, width: 2, background: "white" }}
        />

        {/* Scrolling content */}
        <div
          className="absolute top-0"
          style={{ transform: `translateX(${containerW / 2 - offset}px)`, width: trackW }}
        >
          {/* Time ruler */}
          <TimeRuler zoom={zoom} offset={0} />

          {/* Mute / Video track row */}
          <div className="mt-1 flex items-start gap-1">
            {/* Speaker icon */}
            <button
              onClick={() => setClipMuted(!clipMuted)}
              className="grid size-8 shrink-0 place-items-center text-white/60"
              aria-label={clipMuted ? "Unmute clips" : "Mute clips"}
            >
              {clipMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>

            {/* Video track */}
            <div
              className="relative"
              style={{ height: TRACK_H, flex: 1, minWidth: Math.max(0, totalDur * zoom) }}
            >
              {clips.map((clip, i) => {
                const start = clipProjectStart(clips, i);
                const dur = (clip.trimEnd - clip.trimStart) / clip.speed;
                return (
                  <ClipTile
                    key={clip.id}
                    clip={clip}
                    x={start * zoom}
                    width={dur * zoom}
                    selected={clip.id === selectedClipId}
                    onSelect={() => selectClip(clip.id === selectedClipId ? null : clip.id)}
                    onTrimStart={(dx) => handleTrimStart(i, dx)}
                    onTrimEnd={(dx) => handleTrimEnd(i, dx)}
                  />
                );
              })}
            </div>

            {/* Add clip + button */}
            <button
              onClick={onAddClip}
              className="ml-1 grid size-10 shrink-0 place-items-center rounded-full bg-white text-black shadow-lg"
              aria-label="Add clip"
            >
              <Plus className="size-5" />
            </button>
          </div>

          {/* Sound track row — same left edge as the video track */}
          <div className="mt-1 flex items-center gap-1">
            {/* Spacer matching speaker icon width */}
            <div className="size-8 shrink-0" />
            <div
              className="relative flex-1"
              style={{ height: 36, minWidth: Math.max(0, totalDur * zoom) }}
            >
              <SoundTrackRow zoom={zoom} offset={offset} onAdd={onAddSound} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
