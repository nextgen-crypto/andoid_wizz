/**
 * Canvas-based baking of text and emoji sticker overlays into a JPEG image.
 *
 * Overlay positions are stored as normalized 0–1 fractions of the preview
 * container so they map correctly onto any canvas size at export time.
 */

export interface TextOverlay {
  kind: "text";
  id: string;
  text: string;
  x: number; // 0–1
  y: number; // 0–1
  color: string; // CSS color string
  fontSize: "sm" | "md" | "lg";
  bold: boolean;
  bg: "none" | "dark" | "light";
}

export interface StickerOverlay {
  kind: "sticker";
  id: string;
  emoji: string;
  x: number;
  y: number;
  scale: "sm" | "md" | "lg";
}

export type PhotoOverlay = TextOverlay | StickerOverlay;

/* ── Font / scale helpers ── */

function textPx(canvasH: number, size: TextOverlay["fontSize"]): number {
  const pcts = { sm: 0.042, md: 0.065, lg: 0.09 };
  return Math.round(canvasH * pcts[size]);
}

function stickerPx(canvasH: number, scale: StickerOverlay["scale"]): number {
  const pcts = { sm: 0.08, md: 0.12, lg: 0.17 };
  return Math.round(canvasH * pcts[scale]);
}

/* ── Canvas baking ── */

function drawTextOverlay(ctx: CanvasRenderingContext2D, ov: TextOverlay, w: number, h: number) {
  const px = textPx(h, ov.fontSize);
  ctx.font = `${ov.bold ? "bold " : ""}${px}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const cx = ov.x * w;
  const cy = ov.y * h;
  const metrics = ctx.measureText(ov.text);
  const tw = metrics.width;
  const pad = px * 0.35;

  if (ov.bg !== "none") {
    const bgAlpha = ov.bg === "dark" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.65)";
    ctx.fillStyle = bgAlpha;
    const rr = px * 0.3;
    const bx = cx - tw / 2 - pad;
    const by = cy - px / 2 - pad * 0.7;
    const bw = tw + pad * 2;
    const bh = px + pad * 1.4;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, rr);
    ctx.fill();
  }

  ctx.fillStyle = ov.color;
  ctx.fillText(ov.text, cx, cy);
}

function drawStickerOverlay(
  ctx: CanvasRenderingContext2D,
  ov: StickerOverlay,
  w: number,
  h: number,
) {
  const px = stickerPx(h, ov.scale);
  ctx.font = `${px}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(ov.emoji, ov.x * w, ov.y * h);
}

/**
 * Bake an array of overlays on top of `file` and return a new JPEG File.
 * Falls back to the original file on any error so the upload never blocks.
 */
export async function applyOverlaysToFile(file: File, overlays: PhotoOverlay[]): Promise<File> {
  if (!overlays.length) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const MAX = 2048;
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }

    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    for (const ov of overlays) {
      if (ov.kind === "text") drawTextOverlay(ctx, ov, canvas.width, canvas.height);
      if (ov.kind === "sticker") drawStickerOverlay(ctx, ov, canvas.width, canvas.height);
    }

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + "-overlaid.jpg", {
      type: "image/jpeg",
    });
  } catch {
    return file;
  }
}
