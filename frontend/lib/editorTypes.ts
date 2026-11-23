/* ─── Core editor domain types ─────────────────────────────────────────────── */

export type FilterPreset =
  | "none"
  | "vivid"
  | "warm"
  | "cool"
  | "bw"
  | "film"
  | "fade"
  | "chrome"
  | "pro"
  | "matte"
  | "golden";

export interface AdjustValues {
  brightness: number; // -100 .. 100
  contrast: number; // -100 .. 100
  saturation: number; // -100 .. 100
  brilliance: number; // -100 .. 100
  sharpness: number; // 0 .. 100
  highlight: number; // -100 .. 100
  shadow: number; // -100 .. 100
  temperature: number; // -100 .. 100
  tint: number; // -100 .. 100
  fade: number; // 0 .. 100
  vignette: number; // 0 .. 100
  grain: number; // 0 .. 100
}

export const DEFAULT_ADJUST: AdjustValues = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  brilliance: 0,
  sharpness: 0,
  highlight: 0,
  shadow: 0,
  temperature: 0,
  tint: 0,
  fade: 0,
  vignette: 0,
  grain: 0,
};

export interface Keyframe {
  time: number; // seconds in project timeline
  scale: number; // 1 = 100%
  x: number; // normalized 0–1 horizontal offset
  y: number; // normalized 0–1 vertical offset
  rotation: number; // degrees
  opacity: number; // 0–1
  adjust: AdjustValues;
}

export interface EditorClip {
  id: string;
  file: File;
  src: string; // Capacitor.convertFileSrc or createObjectURL
  nativeDuration: number; // full file duration in seconds
  trimStart: number; // seconds from start of file
  trimEnd: number; // seconds from start of file
  speed: number; // 0.1–10
  volume: number; // 0–2
  muted: boolean;
  filter: FilterPreset;
  adjust: AdjustValues;
  keyframes: Keyframe[];
  cropX: number; // 0–1 (pan within frame)
  cropY: number; // 0–1
  cropScale: number; // 1+ (zoom)
  opacity: number; // 0–1
  thumbnails: string[]; // blob URLs of frames
}

export interface SoundTrack {
  id: string;
  title: string;
  artist: string;
  duration: number; // track total duration
  src: string;
  startOffset: number; // which second of the track starts at project time 0
  volume: number; // 0–2
}

export type TextAlign = "left" | "center" | "right";
export type TextBg = "none" | "dark" | "light";
export type TextAnim = "none" | "fade" | "slide" | "pop";

export interface TextLayer {
  id: string;
  text: string;
  x: number; // 0–1
  y: number; // 0–1
  scale: number; // 1 = 100%
  rotation: number;
  color: string;
  fontSize: number; // px
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  bg: TextBg;
  animIn: TextAnim;
  animOut: TextAnim;
  startTime: number;
  endTime: number;
}

export interface StickerLayer {
  id: string;
  emoji: string;
  x: number; // 0–1
  y: number; // 0–1
  scale: number;
  rotation: number;
  startTime: number;
  endTime: number;
}

export interface OverlayLayer {
  id: string;
  src: string;
  x: number;
  y: number;
  width: number; // 0–1
  height: number; // 0–1
  rotation: number;
  opacity: number;
  startTime: number;
  endTime: number;
}

export interface CaptionSegment {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  style: "default" | "bold" | "outline";
}

export interface EditorProject {
  clips: EditorClip[];
  soundTrack: SoundTrack | null;
  textLayers: TextLayer[];
  stickers: StickerLayer[];
  overlays: OverlayLayer[];
  captions: CaptionSegment[];
  globalFilter: FilterPreset;
  globalAdjust: AdjustValues;
  bgColor: string;
}

export const EMPTY_PROJECT: EditorProject = {
  clips: [],
  soundTrack: null,
  textLayers: [],
  stickers: [],
  overlays: [],
  captions: [],
  globalFilter: "none",
  globalAdjust: { ...DEFAULT_ADJUST },
  bgColor: "#000000",
};

/** Compute total project duration from clips (respecting trim + speed). */
export function projectDuration(clips: EditorClip[]): number {
  return clips.reduce((sum, c) => {
    const rawDur = Math.max(0, c.trimEnd - c.trimStart);
    return sum + rawDur / Math.max(0.01, c.speed);
  }, 0);
}

/** Compute the start time (in project time) of a given clip index. */
export function clipProjectStart(clips: EditorClip[], index: number): number {
  let t = 0;
  for (let i = 0; i < index; i++) {
    const c = clips[i]!;
    t += Math.max(0, c.trimEnd - c.trimStart) / Math.max(0.01, c.speed);
  }
  return t;
}

/** Map a project-time position to a clip index + offset within that clip. */
export function resolvePlayhead(
  clips: EditorClip[],
  projectTime: number,
): { clipIndex: number; clipTime: number } | null {
  let cursor = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i]!;
    const dur = Math.max(0, c.trimEnd - c.trimStart) / Math.max(0.01, c.speed);
    if (projectTime <= cursor + dur || i === clips.length - 1) {
      const within = projectTime - cursor;
      return {
        clipIndex: i,
        clipTime: c.trimStart + within * c.speed,
      };
    }
    cursor += dur;
  }
  return null;
}

/** Build a CSS filter string from AdjustValues for live preview. */
export function adjustToCssFilter(a: AdjustValues, f: FilterPreset): string {
  const filters: string[] = [];
  // Brightness: -100..100 → CSS 0..2 (1 = default)
  if (a.brightness !== 0) filters.push(`brightness(${1 + a.brightness / 100})`);
  if (a.contrast !== 0) filters.push(`contrast(${1 + a.contrast / 100})`);
  if (a.saturation !== 0) filters.push(`saturate(${1 + a.saturation / 100})`);
  if (a.sharpness > 0) {
    // No native sharpness in CSS — use contrast as a proxy
    filters.push(`contrast(${1 + a.sharpness * 0.003})`);
  }
  if (a.temperature !== 0) {
    filters.push(`sepia(${Math.max(0, a.temperature) / 200})`);
    if (a.temperature < 0) filters.push(`hue-rotate(${a.temperature * 0.3}deg)`);
  }
  if (a.tint !== 0) filters.push(`hue-rotate(${a.tint * 0.5}deg)`);
  if (a.fade > 0) filters.push(`opacity(${1 - a.fade * 0.003})`);

  // Filter presets
  const presetMap: Record<FilterPreset, string> = {
    none: "",
    vivid: "saturate(1.4) contrast(1.1)",
    warm: "sepia(0.3) saturate(1.2) brightness(1.05)",
    cool: "hue-rotate(20deg) saturate(0.9) brightness(1.02)",
    bw: "grayscale(1)",
    film: "sepia(0.25) contrast(1.1) brightness(0.95)",
    fade: "brightness(1.1) saturate(0.85) contrast(0.9)",
    chrome: "contrast(1.4) saturate(1.3)",
    pro: "contrast(1.15) saturate(0.95) brightness(0.97)",
    matte: "contrast(0.9) saturate(0.8) brightness(1.05)",
    golden: "sepia(0.4) saturate(1.3) brightness(1.1)",
  };
  if (f !== "none" && presetMap[f]) filters.push(presetMap[f]!);

  return filters.join(" ") || "none";
}

/** Sound picker mock tracks (structure matches future API response). */
export interface SoundTrackMeta {
  id: string;
  title: string;
  artist: string;
  duration: string; // "0:54"
  durationSec: number;
  posts: string; // "13.2K"
  coverColor: string; // hex for placeholder
  audioUrl?: string;
}

export const MOCK_SOUNDS: SoundTrackMeta[] = [
  {
    id: "s1",
    title: "As It Was",
    artist: "Harry Styles",
    duration: "0:54",
    durationSec: 54,
    posts: "140.6K",
    coverColor: "#1a1a2e",
  },
  {
    id: "s2",
    title: "Blinding Lights",
    artist: "The Weeknd",
    duration: "1:02",
    durationSec: 62,
    posts: "98.2K",
    coverColor: "#2d1b69",
  },
  {
    id: "s3",
    title: "Stay",
    artist: "Kid LAROI",
    duration: "0:41",
    durationSec: 41,
    posts: "76.5K",
    coverColor: "#0a3d62",
  },
  {
    id: "s4",
    title: "Levitating",
    artist: "Dua Lipa",
    duration: "0:58",
    durationSec: 58,
    posts: "54.1K",
    coverColor: "#6a1a4c",
  },
  {
    id: "s5",
    title: "Peaches",
    artist: "Justin Bieber",
    duration: "0:48",
    durationSec: 48,
    posts: "43.8K",
    coverColor: "#1a3a1a",
  },
  {
    id: "s6",
    title: "Watermelon Sugar",
    artist: "Harry Styles",
    duration: "0:53",
    durationSec: 53,
    posts: "38.2K",
    coverColor: "#6b2737",
  },
  {
    id: "s7",
    title: "Butter",
    artist: "BTS",
    duration: "0:44",
    durationSec: 44,
    posts: "32.7K",
    coverColor: "#3d2800",
  },
  {
    id: "s8",
    title: "Montero",
    artist: "Lil Nas X",
    duration: "0:59",
    durationSec: 59,
    posts: "28.9K",
    coverColor: "#2e0030",
  },
  {
    id: "s9",
    title: "Good 4 U",
    artist: "Olivia Rodrigo",
    duration: "0:57",
    durationSec: 57,
    posts: "26.4K",
    coverColor: "#3b1f00",
  },
  {
    id: "s10",
    title: "Bad Habits",
    artist: "Ed Sheeran",
    duration: "1:05",
    durationSec: 65,
    posts: "22.1K",
    coverColor: "#1a1a3e",
  },
  {
    id: "s11",
    title: "Midnight Drive",
    artist: "Neon Coast",
    duration: "0:29",
    durationSec: 29,
    posts: "18.3K",
    coverColor: "#0d2137",
  },
  {
    id: "s12",
    title: "Golden Hour",
    artist: "Luna Waves",
    duration: "0:18",
    durationSec: 18,
    posts: "12.9K",
    coverColor: "#3d2200",
  },
];
