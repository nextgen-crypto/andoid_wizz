export interface BeautySettings {
  /** Skin smoothing, 0-100 */
  smooth: number;
  /** Brightening / glow, 0-100 */
  glow: number;
  /** Warm (positive) to cool (negative) tone, -100..100 */
  warmth: number;
}

export interface FilterPreset {
  id: string;
  label: string;
  settings: BeautySettings;
  /** Extra CSS filter appended after the beauty maths. */
  extra?: string;
}

export const defaultBeauty: BeautySettings = { smooth: 35, glow: 25, warmth: 15 };

export const filterPresets: FilterPreset[] = [
  { id: "none", label: "Original", settings: { smooth: 0, glow: 0, warmth: 0 } },
  { id: "natural", label: "Natural", settings: { smooth: 25, glow: 15, warmth: 10 } },
  { id: "smooth", label: "Smooth", settings: { smooth: 60, glow: 25, warmth: 12 } },
  { id: "glow", label: "Glow", settings: { smooth: 45, glow: 55, warmth: 20 } },
  { id: "soft", label: "Soft", settings: { smooth: 55, glow: 40, warmth: -10 } },
  { id: "warm", label: "Sunkissed", settings: { smooth: 35, glow: 25, warmth: 60 } },
  { id: "cool", label: "Cool", settings: { smooth: 35, glow: 20, warmth: -55 } },
  // Portrait: smooth skin, warm glow, lifted highlights
  {
    id: "portrait",
    label: "Portrait",
    settings: { smooth: 50, glow: 35, warmth: 18 },
    extra: "brightness(1.04) contrast(0.96)",
  },
  // Cinematic: desaturated, punchy contrast, cool shadows
  {
    id: "cinema",
    label: "Cinema",
    settings: { smooth: 10, glow: 5, warmth: -30 },
    extra: "contrast(1.18) saturate(0.70) brightness(0.95)",
  },
  // Vintage: warm, faded, slight sepia wash
  {
    id: "vintage",
    label: "Vintage",
    settings: { smooth: 20, glow: 15, warmth: 55 },
    extra: "contrast(0.92) saturate(0.80) brightness(1.03)",
  },
  // Golden: sun-drenched warm saturation boost
  {
    id: "golden",
    label: "Golden",
    settings: { smooth: 30, glow: 40, warmth: 80 },
    extra: "saturate(1.20) brightness(1.06)",
  },
  // Dramatic: high contrast, cool, desaturated
  {
    id: "dramatic",
    label: "Dramatic",
    settings: { smooth: 15, glow: 5, warmth: -20 },
    extra: "contrast(1.30) saturate(0.65) brightness(0.93)",
  },
  // Mono: B&W with slight contrast lift
  {
    id: "mono",
    label: "Mono",
    settings: { smooth: 30, glow: 20, warmth: 0 },
    extra: "grayscale(1) contrast(1.08)",
  },
  // Film: classic emulation — grain via contrast micro-boost
  {
    id: "film",
    label: "Film",
    settings: { smooth: 20, glow: 10, warmth: 25 },
    extra: "contrast(1.12) saturate(0.85)",
  },
];

/** Builds a CSS `filter` value usable on both <video> and canvas 2D contexts. */
export function filterCss(settings: BeautySettings, extra?: string, strength = 1): string {
  const s = Math.max(0, Math.min(1, strength));
  const smooth = (settings.smooth / 100) * s;
  const glow = (settings.glow / 100) * s;
  const warmth = (settings.warmth / 100) * s;

  const parts = [
    `blur(${(smooth * 1.1).toFixed(2)}px)`,
    `contrast(${(1 + smooth * 0.12).toFixed(3)})`,
    `brightness(${(1 + glow * 0.18).toFixed(3)})`,
    `saturate(${(1 + glow * 0.12 + Math.max(0, warmth) * 0.15).toFixed(3)})`,
  ];
  if (warmth > 0) parts.push(`sepia(${(warmth * 0.35).toFixed(3)})`);
  if (warmth < 0) parts.push(`hue-rotate(${(warmth * 12).toFixed(1)}deg)`);
  if (extra) parts.push(extra);
  return parts.join(" ");
}

/** Bakes the chosen look into a new JPEG file (used for uploads and captures). */
export async function applyFilterToFile(
  file: File,
  settings: BeautySettings,
  extra: string | undefined,
  strength = 1,
): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.filter = filterCss(settings, extra, strength);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.92));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, "") + "-filtered.jpg", {
    type: "image/jpeg",
  });
}

/**
 * Bakes filter + rotation + flip into a single JPEG pass.
 * rotate: 0 | 90 | 180 | 270 degrees CW.
 * flip: { h: flip horizontal, v: flip vertical }.
 */
export async function applyFilterAndTransformToFile(
  file: File,
  settings: BeautySettings,
  extra: string | undefined,
  strength: number,
  rotate: 0 | 90 | 180 | 270,
  flip: { h: boolean; v: boolean },
): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const sw = bitmap.width;
  const sh = bitmap.height;
  const rotated = rotate === 90 || rotate === 270;
  const canvas = document.createElement("canvas");
  canvas.width = rotated ? sh : sw;
  canvas.height = rotated ? sw : sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return file;
  }
  ctx.filter = filterCss(settings, extra, strength);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  if (rotate) ctx.rotate((rotate * Math.PI) / 180);
  if (flip.h) ctx.scale(-1, 1);
  if (flip.v) ctx.scale(1, -1);
  ctx.drawImage(bitmap, -sw / 2, -sh / 2);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.92));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, "") + "-edit.jpg", { type: "image/jpeg" });
}
