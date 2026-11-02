import { supabase } from "@/integrations/supabase/client";
import { resolveStoredMime } from "@/frontend/lib/mediaFormat";

const TEN_YEARS = 60 * 60 * 24 * 365 * 10;
/**
 * Client-minted media URLs must outlive the query caches that hold them
 * (React Query keeps data for 10 minutes after unmount). Five minutes was
 * shorter than the cache, so hydrated lists rendered expired links that
 * storage rejected with `InvalidJWT`.
 */
export const MEDIA_URL_TTL_SECONDS = 24 * 60 * 60;

type UploadOptions = { contentType?: string; width?: number; upsert?: boolean };

async function uploadObject(
  bucket: string,
  path: string,
  file: File | Blob,
  opts?: UploadOptions,
): Promise<void> {
  const contentType = resolveStoredMime(path, file, opts?.contentType);
  const uploadOptions =
    contentType || opts?.upsert !== undefined
      ? {
          ...(contentType ? { contentType } : {}),
          ...(opts?.upsert !== undefined ? { upsert: opts.upsert } : {}),
        }
      : undefined;

  // Retry up to 3 times with exponential backoff (1s, 2s, 4s).
  // Mobile networks often drop the connection mid-upload; a single retry
  // succeeds in the vast majority of cases without alarming the user.
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => window.setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
    const { error } = await supabase.storage.from(bucket).upload(path, file, uploadOptions);
    if (!error) return;
    const msg = error.message?.toLowerCase() ?? "";
    // Only retry transient network/server errors — not client errors like
    // permission denied or duplicate path, which retrying can't fix.
    const transient =
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("network request failed") ||
      error.statusCode === "500" ||
      error.statusCode === "503" ||
      error.statusCode === "504";
    lastError = error;
    if (!transient) break;
  }
  throw lastError;
}

/** Store the canonical object path; URLs are minted only after post RLS. */
export async function uploadStoredObject(
  bucket: string,
  path: string,
  file: File | Blob,
  opts?: UploadOptions,
): Promise<string> {
  await uploadObject(bucket, path, file, opts);
  return path;
}

/**
 * Legacy upload + long-lived signed URL for schemas that do not yet expose
 * media-path columns. New posting-integrity rows never use this persistence.
 */
export async function uploadAndSign(
  bucket: string,
  path: string,
  file: File | Blob,
  opts?: UploadOptions,
): Promise<string> {
  await uploadObject(bucket, path, file, opts);
  if (opts?.width) {
    const transformed = await supabase.storage.from(bucket).createSignedUrl(path, TEN_YEARS, {
      transform: { width: opts.width, quality: 75 },
    });
    if (!transformed.error) return transformed.data.signedUrl;
  }
  const signed = await supabase.storage.from(bucket).createSignedUrl(path, TEN_YEARS);
  if (signed.error) throw signed.error;
  return signed.data.signedUrl;
}

/** Extract the object path from a plain or signed Supabase Storage URL. */
export function storageObjectPath(bucket: string, value: string): string | null {
  if (!value) return null;
  if (!value.startsWith("http")) return value;
  try {
    const pathname = decodeURIComponent(new URL(value).pathname);
    const marker = `/${bucket}/`;
    const index = pathname.lastIndexOf(marker);
    return index >= 0 ? pathname.slice(index + marker.length) : null;
  } catch {
    return null;
  }
}

/** Best-effort cleanup after a failed database write or permanent post deletion. */
export async function removeStoredObjects(
  bucket: string,
  values: Array<string | null | undefined>,
): Promise<void> {
  const paths = [
    ...new Set(
      values
        .filter((value): value is string => Boolean(value))
        .map((value) => storageObjectPath(bucket, value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) console.warn(`[storage] Could not remove ${paths.length} object(s)`, error.message);
}
