import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Crop,
  FlipHorizontal2,
  ImagePlus,
  Loader2,
  Music,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Video,
  Volume2,
  VolumeX,
  X,
  Users,
  Link2,
  Mic,
  MicOff,
  MapPin,
  AtSign,
  Clock,
  Square,
  Share2,
  Check,
  FolderOpen,
  FlipVertical2,
  SlidersHorizontal,
} from "lucide-react";
import { filterCss, filterPresets } from "@/frontend/components/camera/beautyFilters";
import type { PhotoAdjustments, VideoAdjust } from "@/frontend/components/create/creationEngine";
import { formatBytes } from "@/frontend/lib/mediaCompressor";
import { useAudioPlayer } from "@/frontend/lib/audioPlayer";
import type { Track } from "@/frontend/lib/audioPlayer";
import type { PhotoOverlay, TextOverlay, StickerOverlay } from "@/frontend/lib/overlayBaker";
import { captureVideoFrame } from "@/frontend/lib/videoEdit";
import { cn } from "@/lib/utils";

export { AtSign, Clock, FolderOpen, Link2, MapPin, Mic, MicOff, Music, RefreshCw, Users, Share2, Square };
export type { Track };
export type { PhotoOverlay, TextOverlay, StickerOverlay };

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3] as const;

// Text overlay colors
const TEXT_COLORS = [
  "#ffffff", "#000000", "#ffee00", "#ff3366",
  "#00ccff", "#66ff88", "#ff9900", "#cc44ff",
] as const;

// Sticker emoji grid (4 rows × 10 = 40 emojis)
const EMOJI_GRID = [
  "😍","🥰","😂","🤩","😎","🥳","😅","💀","🤣","😜",
  "❤️","💕","💯","🔥","✨","🌟","💫","⭐","💥","🎯",
  "🎉","🎵","🎶","💃","🕺","👑","🌈","🦋","🎊","🏆",
  "💪","👏","🙌","🫶","💬","📸","🌊","🏄","🚀","💎",
] as const;

export const TRACKS: Track[] = [
  { id: "t1", title: "Midnight Drive",  creator: "Neon Coast",  duration: "0:29", durationSec: 29, bars: [3, 6, 9, 5, 8, 4, 7, 10, 6, 5, 8, 3] },
  { id: "t2", title: "Soft Morning",    creator: "Ayo Beats",    duration: "0:15", durationSec: 15, bars: [4, 5, 6, 7, 5, 4, 6, 8,  5, 4, 3, 5] },
  { id: "t3", title: "Street Pulse",    creator: "DJ Mara",      duration: "0:22", durationSec: 22, bars: [8, 4, 9, 3, 10, 5, 7, 4, 9, 6, 5, 8] },
  { id: "t4", title: "Golden Hour",     creator: "Luna Waves",   duration: "0:18", durationSec: 18, bars: [5, 7, 4, 8, 6, 9, 5, 7,  4, 6, 8, 5] },
  { id: "t5", title: "Original audio",  creator: "You",          duration: "0:00", durationSec: 0,  bars: [2, 3, 2, 4, 3, 2, 3, 4,  2, 3, 2, 3] },
];

function fmtTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Reusable toggle switch row */
export function ToggleRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3 rounded-xl px-2 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-tight">{title}</span>
        {desc && <span className="mt-0.5 block text-xs text-muted-foreground">{desc}</span>}
      </span>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-brand" : "bg-border",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  PHOTO STEP                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

export function PhotoStep({
  photoUrl,
  photoUrls,
  activePhoto,
  setActivePhoto,
  removePhoto,
  movePhoto,
  maxPhotos,
  photoFilter,
  photoTransform,
  vignetteStrength,
  presetId,
  setPresetId,
  intensity,
  setIntensity,
  adjust,
  setAdjust,
  rotate,
  setRotate,
  flip,
  setFlip,
  overlays,
  setOverlays,
  photoQuality,
  setPhotoQuality,
  rawPhotoSize,
  estimatedPhotoSize,
  onCamera,
  onUpload,
  onAddMore,
  onContinue,
  onCrop,
  error,
}: {
  photoUrl: string | null;
  photoUrls: string[];
  activePhoto: number;
  setActivePhoto: (i: number) => void;
  removePhoto: (i: number) => void;
  movePhoto: (i: number, delta: -1 | 1) => void;
  maxPhotos: number;
  photoFilter: string;
  photoTransform?: string | undefined;
  vignetteStrength: number;
  presetId: string;
  setPresetId: (v: string) => void;
  intensity: number;
  setIntensity: (v: number) => void;
  adjust: PhotoAdjustments;
  setAdjust: (v: PhotoAdjustments) => void;
  rotate: 0 | 90 | 180 | 270;
  setRotate: (v: 0 | 90 | 180 | 270) => void;
  flip: { h: boolean; v: boolean };
  setFlip: (v: { h: boolean; v: boolean }) => void;
  overlays: PhotoOverlay[];
  setOverlays: (v: PhotoOverlay[]) => void;
  photoQuality: number;
  setPhotoQuality: (v: number) => void;
  rawPhotoSize: number;
  estimatedPhotoSize: number;
  onCamera: () => void;
  onUpload: () => void;
  onAddMore: () => void;
  onContinue: () => void;
  onCrop: () => void;
  error: string | null;
}) {
  const [tab, setTab] = useState<"filters" | "adjust" | "tools" | "text">("filters");

  if (!photoUrl) {
    return (
      <div className="flex flex-col gap-4 px-1 py-2">
        <button
          onClick={onCamera}
          className="press flex items-center gap-4 rounded-2xl bg-secondary p-4"
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand/10">
            <Camera className="size-6 text-brand" />
          </span>
          <span className="text-left">
            <span className="block font-semibold">Camera</span>
            <span className="text-xs text-muted-foreground">Take a photo with live filters</span>
          </span>
          <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </button>
        <button
          onClick={onUpload}
          className="press flex items-center gap-4 rounded-2xl bg-secondary p-4"
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand/10">
            <ImagePlus className="size-6 text-brand" />
          </span>
          <span className="text-left">
            <span className="block font-semibold">Gallery</span>
            <span className="text-xs text-muted-foreground">Pick from your photos · up to {maxPhotos}</span>
          </span>
          <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <PhotoPreview
      photoUrl={photoUrl}
      photoFilter={photoFilter}
      photoTransform={photoTransform}
      vignetteStrength={vignetteStrength}
      photoUrls={photoUrls}
      activePhoto={activePhoto}
      setActivePhoto={setActivePhoto}
      removePhoto={removePhoto}
      maxPhotos={maxPhotos}
      onCrop={onCrop}
      onAddMore={onAddMore}
      tab={tab}
      setTab={setTab}
      presetId={presetId}
      setPresetId={setPresetId}
      intensity={intensity}
      setIntensity={setIntensity}
      adjust={adjust}
      setAdjust={setAdjust}
      rotate={rotate}
      setRotate={setRotate}
      flip={flip}
      setFlip={setFlip}
      overlays={overlays}
      setOverlays={setOverlays}
      photoQuality={photoQuality}
      setPhotoQuality={setPhotoQuality}
      rawPhotoSize={rawPhotoSize}
      estimatedPhotoSize={estimatedPhotoSize}
      onUpload={onUpload}
      onContinue={onContinue}
      error={error}
    />
  );
}

/** Extracted so the image-failed state can re-render without affecting outer hook order. */
function PhotoPreview({
  photoUrl,
  photoFilter,
  photoTransform,
  vignetteStrength,
  photoUrls,
  activePhoto,
  setActivePhoto,
  removePhoto,
  maxPhotos,
  onCrop,
  onAddMore,
  tab,
  setTab,
  presetId,
  setPresetId,
  intensity,
  setIntensity,
  adjust,
  setAdjust,
  rotate,
  setRotate,
  flip,
  setFlip,
  overlays,
  setOverlays,
  photoQuality,
  setPhotoQuality,
  rawPhotoSize,
  estimatedPhotoSize,
  onUpload,
  onContinue,
  error,
}: {
  photoUrl: string;
  photoFilter: string;
  photoTransform?: string | undefined;
  vignetteStrength: number;
  photoUrls: string[];
  activePhoto: number;
  setActivePhoto: (i: number) => void;
  removePhoto: (i: number) => void;
  maxPhotos: number;
  onCrop: () => void;
  onAddMore: () => void;
  tab: "filters" | "adjust" | "tools" | "text";
  setTab: (t: "filters" | "adjust" | "tools" | "text") => void;
  presetId: string;
  setPresetId: (v: string) => void;
  intensity: number;
  setIntensity: (v: number) => void;
  adjust: PhotoAdjustments;
  setAdjust: (v: PhotoAdjustments) => void;
  rotate: 0 | 90 | 180 | 270;
  setRotate: (v: 0 | 90 | 180 | 270) => void;
  flip: { h: boolean; v: boolean };
  setFlip: (v: { h: boolean; v: boolean }) => void;
  overlays: PhotoOverlay[];
  setOverlays: (v: PhotoOverlay[]) => void;
  photoQuality: number;
  setPhotoQuality: (v: number) => void;
  rawPhotoSize: number;
  estimatedPhotoSize: number;
  onUpload: () => void;
  onContinue: () => void;
  error: string | null;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  // Overlay drag state
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Text overlay input state
  const [textInput, setTextInput] = useState("");
  const [textColor, setTextColor] = useState<string>(TEXT_COLORS[0]);
  const [textSize, setTextSize] = useState<TextOverlay["fontSize"]>("md");
  const [textBold, setTextBold] = useState(false);
  const [textBg, setTextBg] = useState<TextOverlay["bg"]>("none");

  const vignetteStyle: React.CSSProperties | undefined =
    vignetteStrength > 0
      ? {
          background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${(vignetteStrength / 100) * 0.75}) 100%)`,
          pointerEvents: "none",
        }
      : undefined;

  return (
    <div className="flex flex-col gap-0">
      {/* ── Full-bleed preview ── */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-2xl bg-black"
        style={{ aspectRatio: "4/5" }}
        onPointerDown={() => setSelectedId(null)}
      >
        {imgFailed ? (
          <div className="grid size-full place-items-center gap-2 text-white/60">
            <ImagePlus className="size-10 opacity-50" />
            <span className="text-xs">Preview not available on this device</span>
            <span className="text-[11px] opacity-60">The photo will still upload correctly</span>
          </div>
        ) : (
          <img
            src={photoUrl}
            alt="Edit preview"
            style={{ filter: photoFilter, transform: photoTransform }}
            className="size-full object-cover transition-transform"
            draggable={false}
            onError={() => setImgFailed(true)}
          />
        )}
        {/* Vignette overlay (separate from CSS filter — canvas baking handles it at export) */}
        {vignetteStyle && <div className="absolute inset-0" style={vignetteStyle} />}

        {/* ── Photo overlays (text + stickers) ── */}
        {overlays.map((ov) => {
          const isSelected = selectedId === ov.id;
          const previewStyle: React.CSSProperties = {
            position: "absolute",
            left: `${ov.x * 100}%`,
            top: `${ov.y * 100}%`,
            transform: "translate(-50%, -50%)",
            touchAction: "none",
            userSelect: "none",
            cursor: "grab",
            zIndex: isSelected ? 20 : 10,
          };
          const textSizeCss: Record<TextOverlay["fontSize"], string> = {
            sm: "clamp(11px,3.2vw,18px)",
            md: "clamp(16px,5vw,28px)",
            lg: "clamp(22px,6.5vw,38px)",
          };
          const stickerSizeCss: Record<StickerOverlay["scale"], string> = {
            sm: "clamp(20px,6vw,34px)",
            md: "clamp(28px,8.5vw,48px)",
            lg: "clamp(38px,11vw,64px)",
          };
          return (
            <div
              key={ov.id}
              style={previewStyle}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                setSelectedId(ov.id);
                const el = containerRef.current;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                dragRef.current = {
                  id: ov.id,
                  ox: e.clientX - rect.left - ov.x * rect.width,
                  oy: e.clientY - rect.top - ov.y * rect.height,
                };
              }}
              onPointerMove={(e) => {
                if (!dragRef.current || dragRef.current.id !== ov.id) return;
                const el = containerRef.current;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                const x = Math.max(0.04, Math.min(0.96, (e.clientX - rect.left - dragRef.current.ox) / rect.width));
                const y = Math.max(0.04, Math.min(0.96, (e.clientY - rect.top - dragRef.current.oy) / rect.height));
                setOverlays(overlays.map((o) => (o.id === ov.id ? { ...o, x, y } : o)));
              }}
              onPointerUp={() => { dragRef.current = null; }}
            >
              {/* Delete button (only when selected) */}
              {isSelected && (
                <button
                  className="absolute -right-2.5 -top-2.5 z-30 grid size-5 place-items-center rounded-full bg-black/70 text-white"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOverlays(overlays.filter((o) => o.id !== ov.id));
                    setSelectedId(null);
                  }}
                >
                  <X className="size-2.5" />
                </button>
              )}

              {ov.kind === "text" && (
                <span
                  style={{
                    fontSize: textSizeCss[ov.fontSize],
                    fontWeight: ov.bold ? "bold" : "normal",
                    color: ov.color,
                    padding: "2px 6px",
                    borderRadius: "6px",
                    backgroundColor:
                      ov.bg === "dark"
                        ? "rgba(0,0,0,0.55)"
                        : ov.bg === "light"
                          ? "rgba(255,255,255,0.65)"
                          : "transparent",
                    whiteSpace: "nowrap",
                    display: "block",
                    lineHeight: 1.2,
                    outline: isSelected ? "2px solid rgba(255,255,255,0.7)" : "none",
                    outlineOffset: "2px",
                  }}
                >
                  {ov.text}
                </span>
              )}

              {ov.kind === "sticker" && (
                <span
                  style={{
                    fontSize: stickerSizeCss[ov.scale],
                    display: "block",
                    lineHeight: 1,
                    outline: isSelected ? "2px solid rgba(255,255,255,0.7)" : "none",
                    outlineOffset: "3px",
                    borderRadius: "4px",
                  }}
                >
                  {ov.emoji}
                </span>
              )}
            </div>
          );
        })}

        {/* Overlay controls */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
          {photoUrls.length > 1 && (
            <span className="rounded-full bg-black/55 px-2.5 py-1 text-xs font-bold text-white tabular-nums">
              {activePhoto + 1} / {photoUrls.length}
            </span>
          )}
          <button
            onClick={onCrop}
            aria-label="Crop"
            className="ml-auto flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-bold text-white"
          >
            <Crop className="size-3.5" /> Crop
          </button>
        </div>
      </div>

      {/* ── Carousel strip ── */}
      {photoUrls.length > 0 && (
        <div className="flex gap-2 overflow-x-auto py-3 no-scrollbar">
          {photoUrls.map((url, i) => (
            <div key={`${url}-${i}`} className="relative shrink-0">
              <button
                onClick={() => setActivePhoto(i)}
                aria-label={`Photo ${i + 1}`}
                className={cn(
                  "block size-[60px] overflow-hidden rounded-xl",
                  i === activePhoto
                    ? "ring-2 ring-brand ring-offset-1 ring-offset-background"
                    : "opacity-60",
                )}
              >
                <img src={url} alt="" className="size-full object-cover" />
              </button>
              {photoUrls.length > 1 && (
                <button
                  onClick={() => removePhoto(i)}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute -right-1 -top-1 grid size-[18px] place-items-center rounded-full bg-black/70 text-white"
                >
                  <X className="size-2.5" />
                </button>
              )}
            </div>
          ))}
          {photoUrls.length < maxPhotos && (
            <button
              onClick={onAddMore}
              aria-label="Add photo"
              className="grid size-[60px] shrink-0 place-items-center rounded-xl border-2 border-dashed border-border text-muted-foreground"
            >
              <ImagePlus className="size-5" />
            </button>
          )}
        </div>
      )}

      {/* ── Edit tabs ── */}
      <div className="mt-1 flex rounded-full bg-secondary p-1">
        {(["filters", "adjust", "tools", "text"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-full py-1 text-[11px] font-semibold capitalize transition-colors",
              tab === t ? "bg-background shadow" : "text-muted-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Filters tab ── */}
      {tab === "filters" && (
        <div className="mt-3">
          <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
            {filterPresets.map((p) => (
              <button key={p.id} onClick={() => setPresetId(p.id)} className="w-[72px] shrink-0 text-center">
                {imgFailed ? (
                  <span
                    className={cn(
                      "block size-[72px] rounded-xl bg-gradient-to-br from-secondary to-muted",
                      presetId === p.id ? "ring-2 ring-brand ring-offset-1" : "opacity-75",
                    )}
                  />
                ) : (
                  <img
                    src={photoUrl}
                    alt={p.label}
                    style={{ filter: filterCss(p.settings, p.extra, intensity / 100) }}
                    onError={() => setImgFailed(true)}
                    className={cn(
                      "size-[72px] rounded-xl object-cover",
                      presetId === p.id ? "ring-2 ring-brand ring-offset-1" : "opacity-75",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "mt-1 block truncate text-[11px]",
                    presetId === p.id ? "font-bold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {p.label}
                </span>
              </button>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-3">
            <span className="w-16 shrink-0 text-[11px] text-muted-foreground">Strength {intensity}%</span>
            <input
              type="range"
              min={0}
              max={100}
              value={intensity}
              onChange={(e) => setIntensity(Number(e.target.value))}
              className="w-full accent-brand"
              aria-label="Filter intensity"
            />
          </label>
        </div>
      )}

      {/* ── Adjust tab ── */}
      {tab === "adjust" && (
        <div className="mt-3 space-y-1.5">
          {(
            [
              ["brightness",  "Brightness",  -100, 100],
              ["contrast",    "Contrast",    -100, 100],
              ["saturation",  "Saturation",  -100, 100],
              ["temperature", "Warmth",      -100, 100],
              ["exposure",    "Exposure",    -100, 100],
              ["highlights",  "Highlights",  -50,  50],
              ["shadows",     "Shadows",     -50,  50],
              ["tint",        "Tint",        -50,  50],
              ["sharpness",   "Sharpness",   0,    100],
              ["vignette",    "Vignette",    0,    100],
              ["fade",        "Fade",        0,    100],
            ] as [keyof PhotoAdjustments, string, number, number][]
          ).map(([k, label, min, max]) => (
            <label key={k} className="flex items-center gap-2">
              <span className="w-[84px] shrink-0 text-[11px] text-muted-foreground">{label}</span>
              <input
                type="range"
                min={min}
                max={max}
                value={adjust[k]}
                onChange={(e) => setAdjust({ ...adjust, [k]: Number(e.target.value) })}
                className="flex-1 accent-brand"
                aria-label={label}
              />
              <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {adjust[k]}
              </span>
            </label>
          ))}
        </div>
      )}

      {/* ── Tools tab ── */}
      {tab === "tools" && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-2 text-[11px] font-semibold text-muted-foreground">Rotate</p>
            <div className="flex gap-2">
              <button
                onClick={() => setRotate((((rotate - 90) % 360 + 360) % 360) as 0 | 90 | 180 | 270)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-secondary py-3 text-xs font-semibold"
              >
                <RotateCcw className="size-4" /> CCW
              </button>
              <button
                onClick={() => setRotate((((rotate + 90) % 360) as 0 | 90 | 180 | 270))}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-secondary py-3 text-xs font-semibold"
              >
                <RotateCw className="size-4" /> CW
              </button>
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold text-muted-foreground">Flip</p>
            <div className="flex gap-2">
              <button
                onClick={() => setFlip({ ...flip, h: !flip.h })}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-semibold transition-colors",
                  flip.h ? "bg-brand text-brand-foreground" : "bg-secondary",
                )}
              >
                <FlipHorizontal2 className="size-4" /> Flip H
              </button>
              <button
                onClick={() => setFlip({ ...flip, v: !flip.v })}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-semibold transition-colors",
                  flip.v ? "bg-brand text-brand-foreground" : "bg-secondary",
                )}
              >
                <FlipVertical2 className="size-4" /> Flip V
              </button>
            </div>
          </div>
          {(rotate !== 0 || flip.h || flip.v) && (
            <button
              onClick={() => { setRotate(0); setFlip({ h: false, v: false }); }}
              className="w-full rounded-full border border-border py-2 text-xs font-semibold text-muted-foreground"
            >
              Reset transforms
            </button>
          )}

          {/* Export size */}
          {rawPhotoSize > 0 && (
            <div className="rounded-2xl bg-secondary p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-muted-foreground">Export size</p>
                {photoQuality >= 92 ? (
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand">
                    High quality
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                    Compressed
                  </span>
                )}
              </div>
              <label className="flex items-center gap-2">
                <span className="w-[72px] shrink-0 text-[11px] text-muted-foreground">
                  Quality {photoQuality}%
                </span>
                <input
                  type="range"
                  min={60}
                  max={100}
                  value={photoQuality}
                  onChange={(e) => setPhotoQuality(Number(e.target.value))}
                  className="flex-1 accent-brand"
                  aria-label="Export quality"
                />
              </label>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">
                  Original <span className="font-semibold text-foreground">{formatBytes(rawPhotoSize)}</span>
                </span>
                <span className="text-muted-foreground">
                  Upload{" "}
                  {estimatedPhotoSize > 0 ? (
                    <span className="font-semibold text-foreground">
                      ~{formatBytes(estimatedPhotoSize)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">…</span>
                  )}
                </span>
                {estimatedPhotoSize > 0 && rawPhotoSize > estimatedPhotoSize && (
                  <span className="font-semibold text-emerald-600">
                    −{Math.round((1 - estimatedPhotoSize / rawPhotoSize) * 100)}%
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Text & Stickers tab ── */}
      {tab === "text" && (
        <div className="mt-3 space-y-3">
          {/* Add text */}
          <div className="rounded-2xl bg-secondary p-3 space-y-2.5">
            <p className="text-[11px] font-semibold text-muted-foreground">Add Text</p>
            <input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Type something…"
              maxLength={80}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
            />
            {/* Color swatches */}
            <div className="flex gap-1.5">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setTextColor(c)}
                  style={{ backgroundColor: c }}
                  className={cn(
                    "size-6 rounded-full border-2 transition-transform",
                    textColor === c ? "border-brand scale-110" : "border-transparent",
                  )}
                />
              ))}
            </div>
            {/* Size / bold / background */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {(["sm", "md", "lg"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setTextSize(s)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-bold",
                    textSize === s ? "bg-brand text-brand-foreground" : "bg-background",
                  )}
                >
                  {s === "sm" ? "S" : s === "md" ? "M" : "L"}
                </button>
              ))}
              <button
                onClick={() => setTextBold(!textBold)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-bold",
                  textBold ? "bg-brand text-brand-foreground" : "bg-background",
                )}
              >
                Bold
              </button>
              <div className="ml-auto flex gap-1">
                {(["none", "dark", "light"] as const).map((bg) => (
                  <button
                    key={bg}
                    onClick={() => setTextBg(bg)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                      bg === "dark" ? "bg-black/60 text-white" : bg === "light" ? "bg-white/90 text-black" : "bg-background",
                      textBg === bg ? "ring-1 ring-brand" : "",
                    )}
                  >
                    {bg === "none" ? "—" : bg === "dark" ? "Dark" : "Light"}
                  </button>
                ))}
              </div>
            </div>
            <button
              disabled={!textInput.trim()}
              onClick={() => {
                if (!textInput.trim()) return;
                const newOv: TextOverlay = {
                  kind: "text",
                  id: `t-${Date.now()}`,
                  text: textInput.trim(),
                  x: 0.5, y: 0.38,
                  color: textColor,
                  fontSize: textSize,
                  bold: textBold,
                  bg: textBg,
                };
                setOverlays([...overlays, newOv]);
                setTextInput("");
              }}
              className="w-full rounded-full bg-brand py-2 text-xs font-bold text-brand-foreground disabled:opacity-50"
            >
              Add to Photo
            </button>
          </div>

          {/* Sticker grid */}
          <div className="rounded-2xl bg-secondary p-3">
            <p className="mb-2 text-[11px] font-semibold text-muted-foreground">Add Sticker</p>
            <div className="grid grid-cols-10 gap-1">
              {EMOJI_GRID.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    const newOv: StickerOverlay = {
                      kind: "sticker",
                      id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                      emoji,
                      x: 0.5, y: 0.5,
                      scale: "md",
                    };
                    setOverlays([...overlays, newOv]);
                  }}
                  className="flex aspect-square items-center justify-center text-lg leading-none"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* Active overlays list */}
          {overlays.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
                On this photo ({overlays.length})
              </p>
              <ul className="space-y-1">
                {overlays.map((ov) => (
                  <li key={ov.id} className="flex items-center gap-2 rounded-xl bg-secondary px-3 py-2">
                    <span className="text-base leading-none">
                      {ov.kind === "sticker" ? ov.emoji : "T"}
                    </span>
                    <span className="flex-1 truncate text-xs text-foreground">
                      {ov.kind === "text" ? `"${ov.text}"` : ov.emoji}
                    </span>
                    <button
                      onClick={() => {
                        setOverlays(overlays.filter((o) => o.id !== ov.id));
                        if (selectedId === ov.id) setSelectedId(null);
                      }}
                      className="shrink-0 text-muted-foreground"
                      aria-label="Remove overlay"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs font-semibold text-live">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button
          onClick={onUpload}
          className="flex-1 rounded-full border border-border py-2.5 text-sm font-semibold"
        >
          Replace
        </button>
        <button
          onClick={onContinue}
          className="flex-1 rounded-full bg-brand py-2.5 text-sm font-bold text-brand-foreground"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  VIDEO STEP                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

export function VideoStep({
  videoUrl,
  proxyFrameUrl,
  playable,
  duration,
  detectedType,
  trim,
  setTrim,
  speed,
  setSpeed,
  muted,
  setMuted,
  videoAdjust,
  setVideoAdjust,
  origVolume,
  setOrigVolume,
  musicVolume,
  setMusicVolume,
  trackId,
  setTrackId,
  coverSet,
  onSetCover,
  canTrim,
  onRecord,
  onUpload,
  onContinue,
  onOpenEditor,
  error,
}: {
  videoUrl: string | null;
  proxyFrameUrl: string | null;
  playable: boolean;
  duration: number | null;
  detectedType: "short" | "video" | null;
  trim: [number, number];
  setTrim: (v: [number, number]) => void;
  speed: number;
  setSpeed: (v: number) => void;
  muted: boolean;
  setMuted: (v: boolean) => void;
  videoAdjust: VideoAdjust;
  setVideoAdjust: (v: VideoAdjust) => void;
  origVolume: number;
  setOrigVolume: (v: number) => void;
  musicVolume: number;
  setMusicVolume: (v: number) => void;
  trackId: string | null;
  setTrackId: (v: string | null) => void;
  coverSet: boolean;
  onSetCover: (file: File) => void;
  canTrim: boolean;
  onRecord: () => void;
  onUpload: () => void;
  onContinue: () => void;
  onOpenEditor?: () => void;
  error: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tab, setTab] = useState<"trim" | "sound" | "adjust" | "cover">("trim");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverNote, setCoverNote] = useState<string | null>(null);

  // Audio player for music track previews
  const player = useAudioPlayer();

  // Keep playback rate in sync
  useEffect(() => {
    const el = videoRef.current;
    if (el) el.playbackRate = speed;
  }, [speed]);

  // Sync music volume (0-100 → 0-1)
  useEffect(() => {
    player.setVolume(musicVolume / 100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicVolume]);

  // Sync original-audio volume to video element
  useEffect(() => {
    const el = videoRef.current;
    if (el) el.volume = origVolume / 100;
  }, [origVolume]);

  // Auto-play selected track when in sound tab; pause when leaving
  useEffect(() => {
    if (tab === "sound" && trackId) {
      const track = TRACKS.find((t) => t.id === trackId);
      if (track && track.durationSec > 0) void player.play(track);
    } else {
      player.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, trackId]);

  // Re-probe when src changes
  useEffect(() => {
    setLoadFailed(false);
    setPlaying(false);
    setCurrentTime(0);
  }, [videoUrl]);

  // Apply video adjust CSS filter
  const videoFilterCss =
    [
      videoAdjust.brightness ? `brightness(${(1 + videoAdjust.brightness / 100).toFixed(3)})` : "",
      videoAdjust.contrast   ? `contrast(${(1 + videoAdjust.contrast / 100).toFixed(3)})` : "",
      videoAdjust.saturation ? `saturate(${(1 + videoAdjust.saturation / 100).toFixed(3)})` : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => setLoadFailed(true));
    } else {
      el.pause();
    }
  }

  async function grabCover() {
    const el = videoRef.current;
    if (!el || coverBusy) return;
    setCoverBusy(true);
    setCoverNote(null);
    const file = await captureVideoFrame(el);
    if (file) {
      onSetCover(file);
      setCoverNote("Cover frame updated.");
    } else {
      setCoverNote("Couldn't grab a frame — scrub the video and try again.");
    }
    setCoverBusy(false);
  }

  // Derived trim in seconds
  const dur = duration ?? 0;
  const trimStartSec = dur > 0 ? (trim[0] / 100) * dur : 0;
  const trimEndSec   = dur > 0 ? (trim[1] / 100) * dur : 0;

  if (!videoUrl) {
    return (
      <div className="flex flex-col gap-4 px-1 py-2">
        <button
          onClick={onRecord}
          className="press flex items-center gap-4 rounded-2xl bg-secondary p-4"
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand/10">
            <Video className="size-6 text-brand" />
          </span>
          <span className="text-left">
            <span className="block font-semibold">Record</span>
            <span className="text-xs text-muted-foreground">Shoot a clip up to 60 seconds</span>
          </span>
          <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </button>
        <button
          onClick={onUpload}
          className="press flex items-center gap-4 rounded-2xl bg-secondary p-4"
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand/10">
            <ImagePlus className="size-6 text-brand" />
          </span>
          <span className="text-left">
            <span className="block font-semibold">Upload from gallery</span>
            <span className="text-xs text-muted-foreground">Any format · up to 200 MB</span>
          </span>
          <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0">
      {/* ── Full-bleed video player ── */}
      <div
        className="relative w-full overflow-hidden rounded-2xl bg-black"
        style={{ aspectRatio: "4/5" }}
        onClick={!loadFailed ? togglePlay : undefined}
      >
        {/* Video element: always rendered for metadata probing even when codec isn't playable */}
        <video
          ref={videoRef}
          src={videoUrl}
          autoPlay
          muted
          playsInline
          loop
          preload="auto"
          style={videoFilterCss ? { filter: videoFilterCss } : undefined}
          className={cn("size-full object-cover", loadFailed && "hidden")}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
          onError={() => setLoadFailed(true)}
          onLoadedMetadata={() => {
            setLoadFailed(false);
            const el = videoRef.current;
            if (el) el.playbackRate = speed;
          }}
        />

        {/* Proxy frame: show a static thumbnail extracted from unsupported codecs */}
        {loadFailed && proxyFrameUrl && (
          <img
            src={proxyFrameUrl}
            alt="Video preview frame"
            className="size-full object-cover"
          />
        )}

        {/* Full failure: codec unsupported + no proxy frame */}
        {loadFailed && !proxyFrameUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="grid size-14 place-items-center rounded-full bg-white/10">
              <Video className="size-7 text-white/60" />
            </div>
            <span className="text-sm font-semibold text-white/80">Video attached</span>
            <span className="text-xs text-white/40 leading-relaxed">
              Preview isn't available for this codec on your device.{"\n"}
              The file will upload at full quality.
            </span>
          </div>
        )}

        {/* Play/pause button (only when video renders) */}
        {!loadFailed && (
          <button
            aria-label={playing ? "Pause" : "Play"}
            onClick={(e) => { e.stopPropagation(); togglePlay(); }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid size-14 place-items-center rounded-full bg-black/50 transition-opacity"
            style={{ opacity: playing ? 0 : 1 }}
          >
            <Play className="size-7 translate-x-0.5 fill-white text-white" />
          </button>
        )}

        {/* Sound toggle */}
        {!loadFailed && (
          <button
            aria-label="Toggle preview sound"
            onClick={(e) => {
              e.stopPropagation();
              const el = videoRef.current;
              if (el) el.muted = !el.muted;
            }}
            className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-black/55"
          >
            <Volume2 className="size-4 text-white" />
          </button>
        )}

        {/* Timecode */}
        {!loadFailed && dur > 0 && (
          <span className="absolute bottom-3 right-3 rounded-full bg-black/55 px-2 py-1 text-[11px] font-bold tabular-nums text-white">
            {fmtTime(currentTime)} / {fmtTime(dur)}
          </span>
        )}

        {detectedType && (
          <span className="absolute bottom-3 left-3 rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold text-white">
            {detectedType === "short" ? "Short" : "Video"}
          </span>
        )}
      </div>

      {/* Seek bar */}
      {!loadFailed && dur > 0 && (
        <input
          type="range"
          min={0}
          max={dur}
          step={0.1}
          value={currentTime}
          onChange={(e) => {
            const el = videoRef.current;
            if (el) el.currentTime = Number(e.target.value);
          }}
          className="mt-2 w-full accent-brand"
          aria-label="Seek"
        />
      )}

      {/* ── Edit tabs ── */}
      <div className="mt-3 flex rounded-full bg-secondary p-1">
        {(["trim", "sound", "adjust", "cover"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-full py-1.5 text-xs font-semibold capitalize transition-colors",
              tab === t ? "bg-background shadow" : "text-muted-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Trim tab ── */}
      {tab === "trim" && (
        <div className="mt-3 rounded-2xl bg-secondary p-4">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Clip range</span>
            {dur > 0 ? (
              <span className="tabular-nums">{fmtTime(trimStartSec)} – {fmtTime(trimEndSec)}</span>
            ) : (
              <span className="tabular-nums">{trim[0]}% – {trim[1]}%</span>
            )}
          </div>
          {/* Waveform visual */}
          <div className="relative mt-2 flex h-10 items-end gap-0.5">
            {Array.from({ length: 20 }).map((_, i) => {
              const active = i / 20 >= trim[0] / 100 && i / 20 <= trim[1] / 100;
              return (
                <span
                  key={i}
                  className={cn("flex-1 rounded-sm transition-colors", active ? "bg-brand" : "bg-border")}
                  style={{ height: `${40 + ((i * 53) % 60)}%` }}
                />
              );
            })}
          </div>
          <div className="mt-3 flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Start</span>
              <input
                type="range"
                min={0}
                max={trim[1] - 1}
                value={trim[0]}
                onChange={(e) => setTrim([Number(e.target.value), trim[1]])}
                className="w-full accent-brand"
                aria-label="Trim start"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">End</span>
              <input
                type="range"
                min={trim[0] + 1}
                max={100}
                value={trim[1]}
                onChange={(e) => setTrim([trim[0], Number(e.target.value)])}
                className="w-full accent-brand"
                aria-label="Trim end"
              />
            </label>
          </div>
          {/* Speed */}
          <div className="mt-3">
            <span className="text-[11px] text-muted-foreground">Speed</span>
            <div className="mt-1.5 flex gap-1">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={cn(
                    "flex-1 rounded-full py-1.5 text-[11px] font-semibold transition-colors",
                    speed === s ? "bg-brand text-brand-foreground" : "bg-background",
                  )}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
          {!canTrim && (
            <p className="mt-2 text-[11px] text-live">
              Trim and speed aren&apos;t available on this device — the full clip will upload.
            </p>
          )}
        </div>
      )}

      {/* ── Sound tab ── */}
      {tab === "sound" && (
        <div className="mt-3 space-y-2">
          <ToggleRow
            title={muted ? "Audio removed" : "Keep original audio"}
            desc="Controls the uploaded clip — not the preview above"
            checked={!muted}
            onChange={(v) => setMuted(!v)}
          />
          {!muted && (
            <label className="flex items-center gap-3 px-2">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">Clip vol {origVolume}%</span>
              <input
                type="range"
                min={0}
                max={100}
                value={origVolume}
                onChange={(e) => setOrigVolume(Number(e.target.value))}
                className="flex-1 accent-brand"
                aria-label="Original audio volume"
              />
            </label>
          )}
          <p className="flex items-center gap-1.5 px-2 text-xs font-semibold text-muted-foreground">
            <Music className="size-3.5" /> Add music track
          </p>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
            {TRACKS.map((t) => {
              const isSelected = trackId === t.id;
              const isPlaying  = player.playingId === t.id;
              const isLoading  = player.loading && isSelected;
              const hasTone    = t.durationSec > 0;
              return (
                <li key={t.id} className="flex flex-col gap-1.5 px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    {/* Play/pause preview button */}
                    <button
                      aria-label={isPlaying ? `Pause ${t.title}` : `Preview ${t.title}`}
                      disabled={!hasTone || isLoading}
                      onClick={() => void player.toggle(t)}
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-full transition-colors",
                        isSelected ? "bg-brand text-brand-foreground" : "bg-secondary text-foreground",
                        (!hasTone || isLoading) && "opacity-50",
                      )}
                    >
                      {isLoading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : isPlaying ? (
                        <Pause className="size-3.5 fill-current" />
                      ) : (
                        <Play className="size-3.5 translate-x-px fill-current" />
                      )}
                    </button>

                    {/* Animated waveform */}
                    <span className="flex h-7 w-16 shrink-0 items-end gap-px" aria-hidden="true">
                      {t.bars.map((h, i) => (
                        <span
                          key={i}
                          style={{
                            height: `${h * 10}%`,
                            animationDelay: `${(i * 60) % 400}ms`,
                          }}
                          className={cn(
                            "w-full rounded-sm transition-colors",
                            isPlaying
                              ? "bg-brand animate-[musicBar_0.6s_ease-in-out_infinite_alternate]"
                              : isSelected
                                ? "bg-brand/60"
                                : "bg-border",
                          )}
                        />
                      ))}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">{t.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {t.creator} · {t.duration}
                      </span>
                    </span>

                    {/* Use / Added toggle */}
                    <button
                      onClick={() => {
                        if (isSelected) {
                          setTrackId(null);
                          player.pause();
                        } else {
                          setTrackId(t.id);
                        }
                      }}
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
                        isSelected ? "bg-brand text-brand-foreground" : "bg-secondary",
                      )}
                    >
                      {isSelected ? "Added" : "Use"}
                    </button>
                  </div>

                  {/* Progress bar under playing track */}
                  {isPlaying && player.duration > 0 && (
                    <div className="ml-11 h-0.5 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-brand transition-[width] duration-100"
                        style={{ width: `${(player.currentTime / player.duration) * 100}%` }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {trackId && (
            <label className="flex items-center gap-3 px-2">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">Music vol {musicVolume}%</span>
              <input
                type="range"
                min={0}
                max={100}
                value={musicVolume}
                onChange={(e) => setMusicVolume(Number(e.target.value))}
                className="flex-1 accent-brand"
                aria-label="Music volume"
              />
            </label>
          )}
        </div>
      )}

      {/* ── Adjust tab ── */}
      {tab === "adjust" && (
        <div className="mt-3 rounded-2xl bg-secondary p-4 space-y-2">
          <p className="text-[11px] text-muted-foreground">Colour adjustments (preview only — not baked into upload)</p>
          {(
            [
              ["brightness", "Brightness"],
              ["contrast",   "Contrast"],
              ["saturation", "Saturation"],
            ] as [keyof VideoAdjust, string][]
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{label}</span>
              <input
                type="range"
                min={-100}
                max={100}
                value={videoAdjust[k]}
                onChange={(e) => setVideoAdjust({ ...videoAdjust, [k]: Number(e.target.value) })}
                className="flex-1 accent-brand"
                aria-label={label}
              />
              <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {videoAdjust[k]}
              </span>
            </label>
          ))}
          {(videoAdjust.brightness !== 0 || videoAdjust.contrast !== 0 || videoAdjust.saturation !== 0) && (
            <button
              onClick={() => setVideoAdjust({ brightness: 0, contrast: 0, saturation: 0 })}
              className="text-[11px] text-muted-foreground underline"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {/* ── Cover tab ── */}
      {tab === "cover" && (
        <div className="mt-3 rounded-2xl bg-secondary p-4 text-sm">
          <p className="text-xs text-muted-foreground">
            Scrub the video above to the frame you want, then tap the button to set it as the cover
            image shown in the feed before playback.
          </p>
          <button
            onClick={() => void grabCover()}
            disabled={coverBusy || loadFailed}
            className="mt-3 rounded-full bg-brand px-4 py-2 text-xs font-bold text-brand-foreground disabled:opacity-60"
          >
            {coverBusy ? "Capturing…" : coverSet ? "Update cover frame" : "Set cover frame"}
          </button>
          {loadFailed && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Cover capture isn't available when preview is unsupported.
            </p>
          )}
          {coverNote && <p className="mt-2 text-[11px] text-muted-foreground">{coverNote}</p>}
        </div>
      )}

      {error && <p className="mt-2 text-xs font-semibold text-live">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button
          onClick={onUpload}
          className="flex-1 rounded-full border border-border py-2.5 text-sm font-semibold"
        >
          Replace
        </button>
        {onOpenEditor && (
          <button
            onClick={onOpenEditor}
            className="flex-1 rounded-full border border-brand/60 py-2.5 text-sm font-semibold text-brand"
          >
            Full editor
          </button>
        )}
        <button
          onClick={onContinue}
          className="flex-1 rounded-full bg-brand py-2.5 text-sm font-bold text-brand-foreground"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  STORY STEP                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

const STORY_DURATIONS = [3, 5, 7, 10] as const;
const STORY_TRANSITIONS = [
  { id: "cut",  label: "Cut" },
  { id: "fade", label: "Fade" },
  { id: "slide", label: "Slide" },
] as const;
const SLIDE_TEXT_COLORS = ["#ffffff", "#ffee00", "#ff3366", "#00ccff", "#000000"] as const;

export function StoryStep({
  photoUrl,
  videoUrl,
  posterUrl,
  textBody,
  textBg,
  overlays,
  toggleOverlay,
  storyPhotos,
  activeSlide,
  setActiveSlide,
  maxSlides,
  onRemoveSlide,
  onAddSlide,
  slideTexts,
  setSlideTexts,
  slideDurations,
  setSlideDurations,
  storyTransition,
  setStoryTransition,
  onClearMedia,
  onPhoto,
  onVideo,
  onText,
  onContinue,
  error,
}: {
  photoUrl: string | null;
  videoUrl: string | null;
  posterUrl: string | null;
  textBody: string;
  textBg: string;
  overlays: string[];
  toggleOverlay: (o: string) => void;
  storyPhotos: string[];
  activeSlide: number;
  setActiveSlide: (i: number) => void;
  maxSlides: number;
  onRemoveSlide: (i: number) => void;
  onAddSlide: () => void;
  slideTexts: string[];
  setSlideTexts: (v: string[]) => void;
  slideDurations: number[];
  setSlideDurations: (v: number[]) => void;
  storyTransition: "cut" | "fade" | "slide";
  setStoryTransition: (v: "cut" | "fade" | "slide") => void;
  onClearMedia: () => void;
  onPhoto: () => void;
  onVideo: () => void;
  onText: () => void;
  onContinue: () => void;
  error: string | null;
}) {
  const isMultiSlide = storyPhotos.length > 0;
  const hasMedia = Boolean(photoUrl || videoUrl);
  const has = Boolean(hasMedia || textBody.trim());

  const activeText = slideTexts[activeSlide] ?? "";
  const activeDuration = slideDurations[activeSlide] ?? 5;

  function setActiveText(v: string) {
    setSlideTexts(slideTexts.map((t, i) => (i === activeSlide ? v : t)));
  }
  function setActiveDuration(v: number) {
    setSlideDurations(slideDurations.map((d, i) => (i === activeSlide ? v : d)));
  }

  return (
    <div className="space-y-4">
      {/* ── Slide strip (multi-photo) ── */}
      {isMultiSlide && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          {storyPhotos.map((url, i) => (
            <div key={`${url}-${i}`} className="relative shrink-0">
              <button
                onClick={() => setActiveSlide(i)}
                aria-label={`Slide ${i + 1}`}
                className={cn(
                  "block size-[56px] overflow-hidden rounded-xl",
                  i === activeSlide
                    ? "ring-2 ring-brand ring-offset-1 ring-offset-background"
                    : "opacity-55",
                )}
              >
                <img src={url} alt="" className="size-full object-cover" />
              </button>
              {storyPhotos.length > 1 && (
                <button
                  onClick={() => onRemoveSlide(i)}
                  aria-label={`Remove slide ${i + 1}`}
                  className="absolute -right-1 -top-1 grid size-[18px] place-items-center rounded-full bg-black/70 text-white"
                >
                  <X className="size-2.5" />
                </button>
              )}
            </div>
          ))}
          {storyPhotos.length < maxSlides && (
            <button
              onClick={onAddSlide}
              aria-label="Add slide"
              className="grid size-[56px] shrink-0 place-items-center rounded-xl border-2 border-dashed border-border text-muted-foreground"
            >
              <ImagePlus className="size-5" />
            </button>
          )}
        </div>
      )}

      {/* ── Preview (phone frame) ── */}
      <div className="relative mx-auto grid aspect-[9/16] max-h-[320px] w-44 place-items-center overflow-hidden rounded-[28px] border-4 border-foreground/20 bg-black shadow-xl">
        {photoUrl ? (
          <img src={photoUrl} alt="Story" className="size-full object-cover" draggable={false} />
        ) : videoUrl ? (
          <video
            src={videoUrl}
            autoPlay
            muted
            playsInline
            loop
            preload="auto"
            className="size-full object-cover"
          />
        ) : textBody.trim() ? (
          <div className="grid size-full place-items-center p-5" style={{ backgroundColor: textBg }}>
            <p className="text-center text-sm font-bold leading-snug text-white">{textBody}</p>
          </div>
        ) : (
          <p className="px-5 text-center text-xs text-white/50">
            Pick a photo, video, or write text below
          </p>
        )}

        {/* Active slide caption preview */}
        {photoUrl && activeText.trim() && (
          <div className="pointer-events-none absolute inset-x-3 bottom-5 rounded-xl bg-black/55 px-2.5 py-2">
            <p className="text-center text-[11px] font-bold leading-snug text-white">
              {activeText}
            </p>
          </div>
        )}

        {/* Sticker chips preview */}
        {has && overlays.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-6 flex flex-col items-center gap-1.5 px-2">
            {overlays.map((o) => (
              <span
                key={o}
                className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white"
              >
                {o}
              </span>
            ))}
          </div>
        )}

        {/* Slide counter badge */}
        {isMultiSlide && (
          <div className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white tabular-nums">
            {activeSlide + 1}/{storyPhotos.length}
          </div>
        )}
      </div>

      {/* ── Per-slide controls (only when photos present) ── */}
      {isMultiSlide && (
        <div className="space-y-3">
          {/* Caption text for this slide */}
          <div className="rounded-2xl bg-secondary p-3 space-y-2">
            <p className="text-[11px] font-semibold text-muted-foreground">
              Caption · slide {activeSlide + 1}
            </p>
            <input
              value={activeText}
              onChange={(e) => setActiveText(e.target.value)}
              placeholder="Add a caption…"
              maxLength={80}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>

          {/* Duration per slide */}
          <div>
            <p className="mb-1.5 px-1 text-[11px] font-semibold text-muted-foreground">
              Duration · slide {activeSlide + 1}
            </p>
            <div className="flex gap-2">
              {STORY_DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setActiveDuration(d)}
                  className={cn(
                    "flex-1 rounded-full py-2 text-xs font-bold transition-colors",
                    activeDuration === d
                      ? "bg-brand text-brand-foreground"
                      : "bg-secondary text-foreground",
                  )}
                >
                  {d}s
                </button>
              ))}
            </div>
          </div>

          {/* Transition (only meaningful with >1 slide) */}
          {storyPhotos.length > 1 && (
            <div>
              <p className="mb-1.5 px-1 text-[11px] font-semibold text-muted-foreground">
                Transition
              </p>
              <div className="flex gap-2">
                {STORY_TRANSITIONS.map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => setStoryTransition(id)}
                    className={cn(
                      "flex-1 rounded-full py-2 text-xs font-bold transition-colors",
                      storyTransition === id
                        ? "bg-brand text-brand-foreground"
                        : "bg-secondary text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Media pickers ── */}
      <div className="grid grid-cols-3 gap-2">
        {[
          {
            label: isMultiSlide ? "Add photo" : hasMedia ? "Change photo" : "Photo",
            icon: Camera,
            action: isMultiSlide ? onAddSlide : onPhoto,
          },
          {
            label: hasMedia ? "Change video" : "Video",
            icon: Video,
            action: onVideo,
            disabled: isMultiSlide,
          },
          { label: "Text card", icon: RefreshCw, action: onText },
        ].map(({ label, icon: Icon, action, disabled }) => (
          <button
            key={label}
            onClick={action}
            disabled={disabled}
            className="press flex flex-col items-center gap-1.5 rounded-2xl bg-secondary py-4 disabled:opacity-40"
          >
            <Icon className="size-5 text-brand" />
            <span className="text-center text-xs font-semibold leading-tight">{label}</span>
          </button>
        ))}
      </div>
      {hasMedia && !isMultiSlide && (
        <button
          onClick={onClearMedia}
          className="flex w-full items-center justify-center gap-1.5 rounded-full bg-secondary py-2 text-xs font-semibold text-muted-foreground"
        >
          <X className="size-3.5" /> Remove media
        </button>
      )}
      {isMultiSlide && storyPhotos.length > 0 && (
        <button
          onClick={onClearMedia}
          className="flex w-full items-center justify-center gap-1.5 rounded-full bg-secondary py-2 text-xs font-semibold text-muted-foreground"
        >
          <X className="size-3.5" /> Clear all slides
        </button>
      )}

      {/* ── Sticker chips ── */}
      <div>
        <p className="mb-2 px-1 text-xs font-semibold text-muted-foreground">Add stickers</p>
        <div className="flex flex-wrap gap-2">
          {["Mention", "Location", "Poll", "Question", "Link", "Countdown"].map((o) => (
            <button
              key={o}
              onClick={() => toggleOverlay(o)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                overlays.includes(o) ? "bg-brand text-brand-foreground" : "bg-secondary",
              )}
            >
              {o}
            </button>
          ))}
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Users className="size-3.5" />
        {isMultiSlide
          ? `${storyPhotos.length} slide${storyPhotos.length > 1 ? "s" : ""} · disappears in 24 hours`
          : "Visible to your audience · disappears in 24 hours"}
      </p>

      {error && <p className="text-xs font-semibold text-live">{error}</p>}

      <button
        onClick={onContinue}
        disabled={!has}
        className="w-full rounded-full bg-brand py-3 text-sm font-bold text-brand-foreground disabled:opacity-50"
      >
        Next
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  HUB CARD (used by creationEngine for the mode-picker grid)                  */
/* ─────────────────────────────────────────────────────────────────────────── */

export function HubCard({
  icon: Icon,
  label,
  hint,
  accent,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  hint: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="press flex flex-col items-center gap-2 rounded-2xl bg-secondary p-5 text-center"
    >
      <span
        className="grid size-12 place-items-center rounded-full"
        style={{ backgroundColor: `${accent}20` }}
      >
        <Icon className="size-6" style={{ color: accent }} />
      </span>
      <span className="block text-[15px] font-bold leading-tight">{label}</span>
      <span className="block text-[11px] leading-tight text-muted-foreground">{hint}</span>
    </button>
  );
}
