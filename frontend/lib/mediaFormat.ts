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
  // Only a real extension counts: a dot-less name ("clip", "VID_0001") is a
  // name, not an extension — treating it as one used to hard-reject picks
  // whose MIME was empty too ("That file is not a video", no preview).
  const dot = file.name.lastIndexOf(".");
  if (dot > 0 && dot < file.name.length - 1) {
    const fromName = file.name.slice(dot + 1).toLowerCase();
    if (fromName.length <= 8) return fromName;
  }
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

/**
 * Signed media URLs can still expire while cached feed data is on screen
 * (storage then answers 400 `InvalidJWT`). Android WebView renders that as a
 * broken-image glyph on every card — swap the element to a transparent pixel
 * so the card degrades to its neutral surface, and drop `srcset` so the
 * browser stops retrying dead candidates.
 */
export function neutralizeBrokenImage(e: { currentTarget: HTMLImageElement }): void {
  const img = e.currentTarget;
  if (img.dataset["mediaFallback"] === "1") return;
  img.dataset["mediaFallback"] = "1";
  img.removeAttribute("srcset");
  img.style.backgroundImage = "none";
  img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
}

/** Whether this device can preview the video before posting. */
export function videoPreviewable(file: File): boolean {
  if (typeof document === "undefined") return true;
  const v = document.createElement("video");
  // Android content picks may report a generic MIME — probe the real container
  // via the extension instead of hard-failing before canPlayType ever runs.
  const mime = file.type.startsWith("video/") ? file.type : `video/${extOf(file)}`;
  if (mime.length > "video/".length) {
    const verdict = v.canPlayType(mime);
    if (verdict === "probably" || verdict === "maybe") return true;
  }
  // Extension allowlist for containers browsers sniff despite empty canPlayType.
  return ["mp4", "m4v", "mov", "webm", "ogv", "3gp", "3g2"].includes(extOf(file));
}

/** Extension fallbacks for picks whose MIME type is missing or generic. */
export const MEDIA_EXTS: Record<"image" | "video", Set<string>> = {
  image: new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "avif", "bmp", "svg"]),
  video: new Set([
    "mp4",
    "m4v",
    "mov",
    "webm",
    "ogv",
    "3gp",
    "3g2",
    "mkv",
    "avi",
    "flv",
    "ts",
    "mts",
    "m2ts",
  ]),
};

/**
 * Android `content://` picks often arrive with an empty MIME type or
 * `application/octet-stream`, which the old `startsWith("video/")` check
 * rejected outright ("That file is not a video") before any preview could
 * render. Only a MIME that *positively names another top-level kind* is
 * evidence against the pick. Everything under `application/` stays undecided
 * on purpose: providers hand out real containers as `application/mp4`,
 * `application/quicktime`, `application/x-matroska`… and treating those as
 * "not a video" is exactly what used to kill the preview with a hard error
 * before the decode probe ever ran.
 */
export function mimeMismatch(file: File, kind: "image" | "video"): boolean {
  const type = file.type;
  if (type && !type.startsWith("application/") && !type.startsWith(`${kind}/`)) {
    return true;
  }
  const undecided = !type || type.startsWith("application/");
  if (!undecided) return false;
  const ext = extOf(file);
  // No useful MIME: a known extension decides; unknown extensions don't block —
  // the image decode test / video metadata probe remain the format authority.
  return Boolean(ext) && !MEDIA_EXTS[kind].has(ext);
}

/**
 * Raw Supabase/storage errors ("invalid input syntax…", "InvalidJWT…", SQL
 * fragments) must never reach the composer — they read like the upload itself
 * was invalid. Map the known families to actionable text, pass short human
 * sentences through, and keep one calm fallback for everything else.
 */
export function friendlyPublishError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const lower = msg.toLowerCase();
  if (lower.includes("row-level security") || lower.includes("permission")) {
    return "You don't have permission to publish this.";
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower.includes("failed host lookup")
  ) {
    return "No internet connection. Check your network and retry.";
  }
  if (lower.includes("payload too large") || lower.includes("exceeded")) {
    return sizeError("video");
  }
  if (lower.includes("jwt") || lower.includes("401") || lower.includes("unauthorized")) {
    return "Your session expired. Sign in again and retry.";
  }
  if (lower.includes("column") && (lower.includes("does not exist") || lower.includes("schema"))) {
    return "Video posting needs the latest Supabase migration before it can be saved.";
  }
  // Database/storage prose reads like the media itself was invalid — only
  // short, human-readable sentences may pass through untouched.
  if (
    !msg ||
    msg.length > 80 ||
    /invalid|error|exception|syntax|duplicate|constraint|token|postgres|pgrst/i.test(msg)
  ) {
    return "Could not publish. Try again.";
  }
  return msg;
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
