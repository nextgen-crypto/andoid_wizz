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

/**
 * Run the canvas bake; on any decode failure return the original file.
 *
 * A deadline guards the whole chain: canvas `toBlob`/`createImageBitmap` on a
 * few Android builds simply never call back, and inside `publish()` that would
 * freeze the progress bar forever with no error. A stuck bake now degrades to
 * the unfiltered original instead.
 */
export async function bakeOrOriginal(file: File, bake: (f: File) => Promise<Blob>): Promise<Blob> {
  if (keepOriginal(file)) return file;
  const deadline = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new Error("bake deadline")), 20_000);
  });
  try {
    return await Promise.race([bake(file), deadline]);
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

/** Canonical MIME per extension — `video/mov` and friends are not real types. */
const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  flv: "video/x-flv",
  ts: "video/mp2t",
  mts: "video/mp2t",
  m2ts: "video/mp2t",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

/** Which media kind an object-path extension stands for; null if neither. */
export function mediaKindForExt(ext: string): "image" | "video" | null {
  const mime = MIME_BY_EXT[ext.toLowerCase()];
  if (!mime) return null;
  return mime.startsWith("image/") ? "image" : "video";
}

/**
 * Content type for an object about to be uploaded, resolved once for every
 * call site (posts, thumbnails, avatars, ads). An explicit caller value wins;
 * otherwise the object path's extension — the most reliable label when the
 * File itself arrived untyped from an Android picker — picks the kind, then
 * the file's own type. Unknown combinations fall through unchanged so
 * non-media uploads keep whatever Storage would have guessed.
 */
export function resolveStoredMime(path: string, file: Blob, explicit?: string): string | undefined {
  if (explicit) return explicit;
  const dot = path.lastIndexOf(".");
  const pathExt = dot > 0 && dot < path.length - 1 ? path.slice(dot + 1).toLowerCase() : "";
  const nameExt = typeof File !== "undefined" && file instanceof File ? extOf(file) : "";
  const ext = pathExt || nameExt;
  const kind =
    mediaKindForExt(ext) ??
    (file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : null);
  if (!kind) return file.type || undefined;
  return resolveUploadMime(file, kind, ext);
}

/**
 * Never forward an empty or `application/*` type to Storage. Providers hand
 * out real containers as `application/mp4`/`application/octet-stream`, and
 * `video/${ext}` invents types like `video/mov` that MIME allowlists reject —
 * the probe result and the extension map decide instead, with kind-safe
 * defaults for everything else.
 */
export function resolveUploadMime(file: Blob, kind: "image" | "video", ext: string): string {
  if (file.type.startsWith(`${kind}/`)) return file.type;
  const byExt = MIME_BY_EXT[ext];
  if (byExt?.startsWith(`${kind}/`)) return byExt;
  return kind === "video" ? "video/mp4" : "image/jpeg";
}

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
export function friendlyPublishError(
  e: unknown,
  fallback = "Could not publish. Try again.",
): string {
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
  // Bare "exceeded" used to map here — that sent photo failures to the video
  // size message. Match the size language itself, and keep "415" word-bounded:
  // hex identifiers contain "415" often enough to misclassify raw UUID errors.
  if (lower.includes("mime type") || lower.includes("unsupported media") || /\b415\b/.test(lower)) {
    return "This file type isn't accepted for upload. Try an MP4 or JPEG.";
  }
  if (lower.includes("payload too large") || lower.includes("maximum allowed size")) {
    return "That file is too large to upload.";
  }
  // Word-bound 401 the same way as 415: hex identifiers embed "401" often
  // enough to fake a session-expiry error out of a storage/database message.
  if (lower.includes("jwt") || /\b401\b/.test(lower) || lower.includes("unauthorized")) {
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
    return fallback;
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

/**
 * Create the poster persisted with a user-uploaded video. Storage does not
 * derive video thumbnails, so decoding failures are intentionally non-fatal:
 * the original video remains publishable even when this device cannot preview it.
 */
export function captureVideoThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    let seekFallback = 0;
    const finish = (thumbnail: Blob | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearTimeout(seekFallback);
      URL.revokeObjectURL(url);
      resolve(thumbnail);
    };
    const timer = window.setTimeout(() => finish(null), 12_000);
    const draw = () => {
      // A fallback may fire before metadata is ready; leave the final deadline
      // to decide rather than treating "not decoded yet" as a failure.
      if (settled || !video.videoWidth || !video.videoHeight) return;
      try {
        const scale = Math.min(1, 1280 / video.videoWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) return finish(null);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob), "image/jpeg", 0.84);
      } catch {
        finish(null);
      }
    };
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      if (!video.videoWidth || !video.videoHeight) return finish(null);
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (duration > 0.05) {
        video.currentTime = Math.min(0.5, Math.max(0.05, duration * 0.1));
      }
      // Clips that report 0/Infinity duration (common in Android WebView)
      // never fire `seeked` when seeking to 0. Draw the first decoded frame
      // instead of leaving the preview black until the 12s deadline.
      seekFallback = window.setTimeout(draw, 1_500);
    };
    video.onloadeddata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (duration <= 0.05) draw();
    };
    video.onseeked = draw;
    video.src = url;
  });
}

/** Read a video file's dimensions/duration so uploads self-classify. */
export function probeVideoMetadata(file: File): Promise<VideoMetadata | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const done = (meta: VideoMetadata | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    // Some Android builds fire neither `onloadedmetadata` nor `onerror`; without
    // a deadline the promise — and the preview state derived from it — hangs.
    const timer = window.setTimeout(() => done(null), 8000);
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
