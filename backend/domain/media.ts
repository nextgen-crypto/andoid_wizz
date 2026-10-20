/**
 * Object-storage + CDN addressing.
 *
 * PostgreSQL stores only `objectKey`. Renditions (thumbnail/small/medium/
 * large/original) are generated on ingest and served from the CDN edge, so the
 * client never downloads an original when a 400px thumbnail is enough.
 */

export type Rendition = "thumbnail" | "small" | "medium" | "large" | "original";

const RENDITION_WIDTH: Record<Rendition, number> = {
  thumbnail: 200,
  small: 400,
  medium: 800,
  large: 1280,
  original: 1920,
};

/**
 * Base for resolving storage object keys that are not already absolute URLs.
 * Set MEDIA_BASE_URL to the Supabase storage/public URL prefix in production
 * (e.g. https://<project>.supabase.co/storage/v1/object/public/post-images).
 * Falls back to the picsum placeholder for local development only.
 */
function mediaBase(): string {
  return process.env["MEDIA_BASE_URL"]?.replace(/\/$/, "") || `https://picsum.photos/seed`;
}

const CDN_BASE = mediaBase();

function hashKey(objectKey: string): string {
  return encodeURIComponent(objectKey.replace(/[^a-zA-Z0-9]/g, "-"));
}

/** Resolve an image object key to a CDN URL at the requested rendition. */
export function imageUrl(objectKey: string, rendition: Rendition = "medium", aspect = 1): string {
  // Real Supabase URLs (signed storage URLs) pass through untouched.
  if (objectKey.startsWith("http")) return objectKey;
  const w = RENDITION_WIDTH[rendition];
  const h = Math.max(1, Math.round(w / aspect));
  return `${CDN_BASE}/${hashKey(objectKey)}/${w}/${h}`;
}

/** Low-cost LQIP used behind progressive image loading. */
export function placeholderUrl(objectKey: string): string {
  if (objectKey.startsWith("http")) return objectKey;
  return `${CDN_BASE}/${hashKey(objectKey)}/20/20`;
}

/** Responsive srcset so the device picks the cheapest adequate rendition. */
export function imageSrcSet(objectKey: string, aspect = 1): string {
  if (objectKey.startsWith("http")) return objectKey;
  return (["small", "medium", "large"] as const)
    .map((r) => `${imageUrl(objectKey, r, aspect)} ${RENDITION_WIDTH[r]}w`)
    .join(", ");
}

/**
 * Video delivery. Object keys resolve to compressed, CDN-hosted renditions;
 * originals are never streamed to clients.
 */
export function videoUrl(objectKey: string): string {
  if (objectKey.startsWith("http")) return objectKey;
  const base = process.env["MEDIA_BASE_URL"]?.replace(/\/$/, "");
  return base ? `${base}/${objectKey}` : `https://cdn.buzz.app/${objectKey}`;
}

/** Quality ladder for adaptive bitrate streaming. */
export interface VideoQuality {
  /** Human-readable label shown in the quality selector. */
  label: string;
  /** Vertical resolution (e.g. 1080 for 1080p). */
  height: number;
  /** Target bitrate in bits per second. */
  bitrate: number;
  /** Suffix appended to the base object key (e.g. "_1080p"). */
  suffix: string;
}

export const VIDEO_QUALITIES: VideoQuality[] = [
  { label: "1080p", height: 1080, bitrate: 5_000_000, suffix: "_1080p" },
  { label: "720p", height: 720, bitrate: 2_500_000, suffix: "_720p" },
  { label: "480p", height: 480, bitrate: 1_000_000, suffix: "_480p" },
  { label: "360p", height: 360, bitrate: 500_000, suffix: "_360p" },
  { label: "240p", height: 240, bitrate: 250_000, suffix: "_240p" },
];

/**
 * Resolve the URL for a specific quality rendition. Falls back to the
 * original object key when no rendition suffix matches (single-file videos).
 */
export function videoQualityUrl(objectKey: string, quality: VideoQuality): string {
  if (objectKey.startsWith("http")) return objectKey;
  const dotIndex = objectKey.lastIndexOf(".");
  const base = dotIndex > 0 ? objectKey.slice(0, dotIndex) : objectKey;
  const ext = dotIndex > 0 ? objectKey.slice(dotIndex) : ".mp4";
  return videoUrl(`${base}${quality.suffix}${ext}`);
}

/**
 * Pick the highest quality whose bitrate fits within the given bandwidth.
 * Returns the lowest quality when bandwidth is insufficient for all.
 */
export function pickQualityForBandwidth(
  bandwidthBps: number,
  qualities: VideoQuality[] = VIDEO_QUALITIES,
): VideoQuality {
  const sorted = [...qualities].sort((a, b) => b.bitrate - a.bitrate);
  for (const q of sorted) {
    if (bandwidthBps >= q.bitrate * 1.2) return q;
  }
  return sorted[sorted.length - 1] ?? VIDEO_QUALITIES[VIDEO_QUALITIES.length - 1]!;
}
