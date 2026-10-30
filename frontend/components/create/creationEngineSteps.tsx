import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  ChevronRight,
  Clock,
  Crop,
  ImagePlus,
  Link2,
  Loader2,
  MapPin,
  Mic,
  MicOff,
  Music,
  RefreshCw,
  Share2,
  Square,
  Users,
  Video,
  X,
} from "lucide-react";
import {
  filterCss,
  filterPresets,
  applyFilterToFile,
} from "@/frontend/components/camera/beautyFilters";
import { BeautyCameraSheet } from "@/frontend/components/camera/BeautyCameraSheet";
import { CropSheet } from "@/frontend/components/create/CropSheet";

const SPEEDS = [0.5, 1, 1.5, 2] as const;
export const TRACKS = [
  {
    id: "t1",
    title: "Midnight Drive",
    creator: "Neon Coast",
    duration: "0:29",
    bars: [3, 6, 9, 5, 8, 4, 7, 10, 6, 5, 8, 3],
  },
  {
    id: "t2",
    title: "Soft Morning",
    creator: "Ayo Beats",
    duration: "0:15",
    bars: [4, 5, 6, 7, 5, 4, 6, 8, 5, 4, 3, 5],
  },
  {
    id: "t3",
    title: "Street Pulse",
    creator: "DJ Mara",
    duration: "0:22",
    bars: [8, 4, 9, 3, 10, 5, 7, 4, 9, 6, 5, 8],
  },
  {
    id: "t4",
    title: "Golden Hour",
    creator: "Luna Waves",
    duration: "0:18",
    bars: [5, 7, 4, 8, 6, 9, 5, 7, 4, 6, 8, 5],
  },
  {
    id: "t5",
    title: "Original audio",
    creator: "You",
    duration: "0:00",
    bars: [2, 3, 2, 4, 3, 2, 3, 4, 2, 3, 2, 3],
  },
];

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
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-brand" : "bg-border"}`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`}
        />
      </button>
    </div>
  );
}

export function PhotoStep({
  photoUrl,
  photoFilter,
  presetId,
  setPresetId,
  intensity,
  setIntensity,
  adjust,
  setAdjust,
  onCamera,
  onUpload,
  onContinue,
  onCrop,
  error,
}: {
  photoUrl: string | null;
  photoFilter: string;
  presetId: string;
  setPresetId: (v: string) => void;
  intensity: number;
  setIntensity: (v: number) => void;
  adjust: { brightness: number; contrast: number; saturation: number; temperature: number };
  setAdjust: (v: {
    brightness: number;
    contrast: number;
    saturation: number;
    temperature: number;
  }) => void;
  onCamera: () => void;
  onUpload: () => void;
  onContinue: () => void;
  onCrop: () => void;
  error: string | null;
}) {
  const [tab, setTab] = useState<"filters" | "adjust">("filters");
  if (!photoUrl) {
    return (
      <div className="grid grid-cols-2 gap-3 px-1 py-1">
        <button
          onClick={onCamera}
          className="press flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border bg-secondary py-7"
        >
          <Camera className="size-6 text-brand" />
          <span className="text-sm font-semibold">Camera</span>
          <span className="text-xs text-muted-foreground">Capture with filters</span>
        </button>
        <button
          onClick={onUpload}
          className="press flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border bg-secondary py-7"
        >
          <ImagePlus className="size-6 text-brand" />
          <span className="text-sm font-semibold">Gallery</span>
          <span className="text-xs text-muted-foreground">Any format · up to 25 MB</span>
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="relative">
        <img
          src={photoUrl}
          alt="Edit preview"
          style={{ filter: photoFilter }}
          className="max-h-72 w-full rounded-2xl border border-border object-cover"
        />
        <button
          onClick={onCrop}
          aria-label="Crop photo"
          className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-scrim px-3 py-1.5 text-xs font-bold text-white"
        >
          <Crop className="size-3.5" /> Crop
        </button>
      </div>
      <div className="flex rounded-full bg-secondary p-1">
        {(["filters", "adjust"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full py-1.5 text-xs font-semibold capitalize ${tab === t ? "bg-background shadow-raise" : "text-muted-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "filters" ? (
        <div>
          <div className="rail flex gap-2 overflow-x-auto pb-1">
            {filterPresets.map((p) => (
              <button key={p.id} onClick={() => setPresetId(p.id)} className="w-16 shrink-0">
                <img
                  src={photoUrl}
                  alt={p.label}
                  style={{ filter: filterCss(p.settings, p.extra, intensity / 100) }}
                  className={`size-16 rounded-xl object-cover ${presetId === p.id ? "ring-2 ring-brand ring-offset-2 ring-offset-background" : "opacity-80"}`}
                />
                <span
                  className={`mt-1 block truncate text-center text-[11px] ${presetId === p.id ? "font-bold text-foreground" : "text-muted-foreground"}`}
                >
                  {p.label}
                </span>
              </button>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-3 px-1">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">
              Intensity {intensity}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={intensity}
              onChange={(e) => setIntensity(Number(e.target.value))}
              className="w-full"
              aria-label="Filter intensity"
            />
          </label>
        </div>
      ) : (
        <div className="space-y-1 px-1">
          {(
            [
              ["brightness", "Brightness"],
              ["contrast", "Contrast"],
              ["saturation", "Saturation"],
              ["temperature", "Temperature"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
              <input
                type="range"
                min={-50}
                max={50}
                value={adjust[k]}
                onChange={(e) => setAdjust({ ...adjust, [k]: Number(e.target.value) })}
                className="w-full"
                aria-label={label}
              />
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-xs font-semibold text-live">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={onUpload}
          className="flex-1 rounded-full bg-secondary py-2.5 text-sm font-semibold"
        >
          Replace
        </button>
        <button
          onClick={onContinue}
          className="flex-1 rounded-full bg-brand py-2.5 text-sm font-bold text-brand-foreground"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

export function VideoStep({
  videoUrl,
  posterUrl,
  playable,
  detectedType,
  trim,
  setTrim,
  speed,
  setSpeed,
  muted,
  setMuted,
  trackId,
  setTrackId,
  onRecord,
  onUpload,
  onContinue,
  error,
}: {
  videoUrl: string | null;
  posterUrl: string | null;
  playable: boolean;
  detectedType: "short" | "video" | null;
  trim: [number, number];
  setTrim: (v: [number, number]) => void;
  speed: number;
  setSpeed: (v: number) => void;
  muted: boolean;
  setMuted: (v: boolean) => void;
  trackId: string | null;
  setTrackId: (v: string | null) => void;
  onRecord: () => void;
  onUpload: () => void;
  onContinue: () => void;
  error: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tab, setTab] = useState<"trim" | "sound" | "style">("trim");
  // canPlayType is only a guess — some codecs report "maybe" and still fail to
  // decode. Track the element's own error so a black box never masquerades as
  // a broken upload: it degrades to the same "still posts fine" reassurance.
  const [decodeFailed, setDecodeFailed] = useState(false);
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);
  if (!videoUrl) {
    return (
      <div className="grid grid-cols-2 gap-3 px-1 py-1">
        <button
          onClick={onRecord}
          className="press flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border bg-secondary py-7"
        >
          <Video className="size-6 text-brand" />
          <span className="text-sm font-semibold">Record</span>
          <span className="text-xs text-muted-foreground">Clip up to 60s</span>
        </button>
        <button
          onClick={onUpload}
          className="press flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border bg-secondary py-7"
        >
          <ImagePlus className="size-6 text-brand" />
          <span className="text-sm font-semibold">Upload</span>
          <span className="text-xs text-muted-foreground">Any video format · up to 200 MB</span>
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <video
        ref={videoRef}
        src={videoUrl}
        poster={posterUrl ?? undefined}
        controls
        playsInline
        muted={muted}
        onError={() => setDecodeFailed(true)}
        onLoadedMetadata={() => setDecodeFailed(false)}
        className="max-h-72 w-full rounded-2xl border border-border bg-media object-cover"
      />
      {(!playable || decodeFailed) && (
        <p className="rounded-xl bg-secondary px-3 py-2 text-xs text-muted-foreground">
          This device can&apos;t preview this format, but it will still post — most phones play it
          fine.
        </p>
      )}
      {detectedType && (
        <p className="rounded-xl bg-brand-soft px-3 py-2 text-xs font-semibold text-brand">
          Detected {detectedType === "short" ? "Short" : "Video"} — it will be filed in{" "}
          {detectedType === "short" ? "Shorts" : "Videos"} automatically.
        </p>
      )}
      <div className="rounded-2xl bg-secondary p-3">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Trim</span>
          <span>
            {trim[0]}% – {trim[1]}%
          </span>
        </div>
        <div className="relative mt-2 flex h-10 items-center gap-1">
          {Array.from({ length: 12 }).map((_, i) => {
            const active = i >= (trim[0] / 100) * 12 && i <= (trim[1] / 100) * 12;
            return (
              <span
                key={i}
                className={`h-full flex-1 rounded ${active ? "bg-brand" : "bg-border"}`}
                style={{ height: `${55 + ((i * 37) % 45)}%` }}
              />
            );
          })}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            type="range"
            min={0}
            max={trim[1] - 1}
            value={trim[0]}
            onChange={(e) => setTrim([Number(e.target.value), trim[1]])}
            className="w-full"
            aria-label="Trim start"
          />
          <input
            type="range"
            min={trim[0] + 1}
            max={100}
            value={trim[1]}
            onChange={(e) => setTrim([trim[0], Number(e.target.value)])}
            className="w-full"
            aria-label="Trim end"
          />
        </div>
      </div>
      <div className="flex rounded-full bg-secondary p-1">
        {(["trim", "sound", "style"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full py-1.5 text-xs font-semibold capitalize ${tab === t ? "bg-background shadow-raise" : "text-muted-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "trim" && (
        <div>
          <span className="px-1 text-xs font-semibold text-muted-foreground">Speed</span>
          <div className="mt-1 flex gap-1.5">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`flex-1 rounded-full py-2 text-xs font-semibold ${speed === s ? "bg-brand text-brand-foreground" : "bg-secondary"}`}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === "sound" && (
        <div>
          <ToggleRow
            title={muted ? "Muted" : "Original sound on"}
            checked={!muted}
            onChange={(v) => setMuted(!v)}
          />
          <p className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-xs font-semibold text-muted-foreground">
            <Music className="size-3.5" /> Music
          </p>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {TRACKS.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                <span className="flex h-7 flex-1 items-end gap-0.5">
                  {t.bars.map((h, i) => (
                    <span
                      key={i}
                      style={{ height: `${h * 10}%` }}
                      className={`w-full rounded-sm ${trackId === t.id ? "bg-brand" : "bg-border"}`}
                    />
                  ))}
                </span>
                <span className="w-28 shrink-0">
                  <span className="block truncate text-xs font-semibold">{t.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {t.creator} · {t.duration}
                  </span>
                </span>
                <button
                  onClick={() => setTrackId(trackId === t.id ? null : t.id)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${trackId === t.id ? "bg-brand text-brand-foreground" : "bg-secondary"}`}
                >
                  {trackId === t.id ? "Added" : "Use"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tab === "style" && (
        <div className="rounded-2xl bg-secondary px-3 py-2 text-xs text-muted-foreground">
          Filters and cover frames apply at publish. Your {speed}× speed
          {muted ? ", muted" : ""} and trim {trim[0]}–{trim[1]}% are kept with this draft.
        </div>
      )}
      {error && <p className="text-xs font-semibold text-live">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={onUpload}
          className="flex-1 rounded-full bg-secondary py-2.5 text-sm font-semibold"
        >
          Replace
        </button>
        <button
          onClick={onContinue}
          className="flex-1 rounded-full bg-brand py-2.5 text-sm font-bold text-brand-foreground"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

export function StoryStep({
  photoUrl,
  videoUrl,
  posterUrl,
  textBody,
  textBg,
  overlays,
  toggleOverlay,
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
  onPhoto: () => void;
  onVideo: () => void;
  onText: () => void;
  onContinue: () => void;
  error: string | null;
}) {
  const has = Boolean(photoUrl || videoUrl || textBody.trim());
  return (
    <div className="space-y-3">
      <div className="relative mx-auto grid aspect-[9/16] max-h-80 w-52 place-items-center overflow-hidden rounded-2xl border border-border bg-media">
        {photoUrl ? (
          <img src={photoUrl} alt="Story preview" className="size-full object-cover" />
        ) : videoUrl ? (
          <video
            src={videoUrl}
            poster={posterUrl ?? undefined}
            muted
            playsInline
            className="size-full object-cover"
          />
        ) : textBody.trim() ? (
          <div
            className="grid size-full place-items-center p-4"
            style={{ backgroundColor: textBg }}
          >
            <p className="text-center text-sm font-bold text-white">{textBody}</p>
          </div>
        ) : (
          <p className="px-6 text-center text-xs text-white/60">Preview — pick a base below</p>
        )}
        {has && overlays.length > 0 && (
          <div className="pointer-events-none absolute flex max-h-80 w-52 flex-col items-center gap-1.5 p-3">
            {overlays.map((o) => (
              <span
                key={o}
                className="rounded-full bg-black/55 px-3 py-1 text-[11px] font-bold text-white"
              >
                {o}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button onClick={onPhoto} className="rounded-full bg-secondary py-2 text-xs font-semibold">
          Photo
        </button>
        <button onClick={onVideo} className="rounded-full bg-secondary py-2 text-xs font-semibold">
          Video
        </button>
        <button onClick={onText} className="rounded-full bg-secondary py-2 text-xs font-semibold">
          Text
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["Mention", "Location", "Poll", "Question", "Link"].map((o) => (
          <button
            key={o}
            onClick={() => toggleOverlay(o)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${overlays.includes(o) ? "bg-brand text-brand-foreground" : "bg-secondary"}`}
          >
            {o}
          </button>
        ))}
      </div>
      <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        <Users className="size-3.5" /> Visible to your audience for 24 hours.
      </p>
      {error && <p className="text-xs font-semibold text-live">{error}</p>}
      <button
        onClick={onContinue}
        disabled={!has}
        className="w-full rounded-full bg-brand py-2.5 text-sm font-bold text-brand-foreground disabled:opacity-50"
      >
        Continue
      </button>
    </div>
  );
}
