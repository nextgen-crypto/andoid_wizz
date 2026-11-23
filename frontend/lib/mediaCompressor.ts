export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Estimate the JPEG byte size of a file at the given quality (0–100).
 * Caps the canvas at maxPx × maxPx to keep it fast. Returns the original
 * file.size on any decode failure.
 */
export async function estimateCompressedSize(
  file: File,
  quality: number,
  maxPx = 2048,
): Promise<number> {
  try {
    const bitmap = await Promise.race<ImageBitmap>([
      createImageBitmap(file),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error("bitmap timeout")), 3000),
      ),
    ]);
    const scale = Math.min(1, maxPx / Math.max(bitmap.width || 1, bitmap.height || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((bitmap.width || 800) * scale);
    canvas.height = Math.round((bitmap.height || 800) * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close?.(); return file.size; }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await Promise.race<Blob | null>([
      new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality / 100)),
      new Promise<null>((res) => window.setTimeout(() => res(null), 10_000)),
    ]);
    return blob?.size ?? file.size;
  } catch {
    return file.size;
  }
}

/**
 * Re-encode a photo File as a JPEG at the given quality (0–100).
 * Returns the original file unchanged when quality >= 100 or on any error.
 * Caps the longest edge at maxPx to avoid oversized outputs.
 */
export async function compressPhoto(
  file: File,
  quality: number,
  maxPx = 2048,
): Promise<File> {
  if (quality >= 100) return file;
  try {
    const bitmap = await Promise.race<ImageBitmap>([
      createImageBitmap(file),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error("bitmap timeout")), 10_000),
      ),
    ]);
    const scale = Math.min(1, maxPx / Math.max(bitmap.width || 1, bitmap.height || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((bitmap.width || 800) * scale);
    canvas.height = Math.round((bitmap.height || 800) * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close?.(); return file; }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    // Guard toBlob — on some Android WebViews it never calls back for large
    // canvases, which would stall the publish flow forever without this race.
    const blob = await Promise.race<Blob | null>([
      new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality / 100)),
      new Promise<null>((res) => window.setTimeout(() => res(null), 15_000)),
    ]);
    if (!blob) return file;
    const stem = file.name.replace(/\.\w+$/, "");
    return new File([blob], `${stem}-compressed.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
