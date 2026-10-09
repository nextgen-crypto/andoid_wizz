/**
 * Upload format policy: every common image and video format is postable.
 *
 * - Pickers use `image/*` / `video/*`, so no format is blocked at selection.
 * - Canvas processing (filters, crop) only understands browser-decodable
 *   rasters. Anything else (GIF animation, SVG, HEIC where unsupported)
 *   uploads as the original file instead of failing.
 * - Video uploads verbatim; playback is best-effort per device codec.
 */

export const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;

export function extOf(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (fromName && fromName.length <= 8) return fromName;
  const fromType = file.type.split("/")[1]?.toLowerCase() ?? "";
  return fromType.length <= 8 ? fromType : "";
}

/** Formats canvas must not touch: baking would destroy animation/vectors. */
export function keepOriginal(file: File): boolean {
  if (file.type === "image/gif" || file.type === "image/svg+xml") return true;
  const ext = extOf(file);
  return ext === "gif" || ext === "svg";
}

/** Run the canvas bake; on any decode failure return the original file. */
export async function bakeOrOriginal(file: File, bake: (f: File) => Promise<Blob>): Promise<Blob> {
  if (keepOriginal(file)) return file;
  try {
    return await bake(file);
  } catch {
    return file;
  }
}

/** Whether this device can preview the video before posting. */
export function videoPreviewable(file: File): boolean {
  if (typeof document === "undefined") return true;
  const v = document.createElement("video");
  const mime = file.type || `video/${extOf(file)}`;
  if (!mime.startsWith("video/")) return false;
  const verdict = v.canPlayType(mime);
  if (verdict === "probably" || verdict === "maybe") return true;
  // Extension allowlist for containers browsers sniff despite empty canPlayType.
  return ["mp4", "m4v", "mov", "webm", "ogv", "3gp", "3g2"].includes(extOf(file));
}

/**
 * Orientation-based classification. Duration is deliberately ignored:
 * portrait goes to Shorts, landscape to Videos, square/ambiguous to Videos.
 */
export function classifyVideoOrientation(width: number, height: number): "short" | "video" {
  if (width > 0 && height > 0 && height / width > 1.05) return "short";
  return "video";
}

export interface VideoMetadata {
  width: number;
  height: number;
  durationSeconds: number;
  contentType: "short" | "video";
}

/** Read a video file's dimensions/duration so uploads self-classify. */
export function probeVideoMetadata(file: File): Promise<VideoMetadata | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (meta: VideoMetadata | null) => {
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const width = video.videoWidth || 0;
      const height = video.videoHeight || 0;
      done({
        width,
        height,
        durationSeconds: Number.isFinite(video.duration) ? Math.round(video.duration) : 0,
        contentType: classifyVideoOrientation(width, height),
      });
    };
    video.onerror = () => done(null);
    video.src = url;
  });
}

export function sizeError(kind: "image" | "video"): string {
  return kind === "image" ? "Images must be under 25 MB." : "Videos must be under 200 MB.";
}
