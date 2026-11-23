import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { resolveStoredMime } from "@/frontend/lib/mediaFormat";
import {
  getR2UploadUrl,
  deleteR2Objects,
} from "@/backend/api/r2Upload.functions";

export const MEDIA_URL_TTL_SECONDS = 24 * 60 * 60;

type UploadOptions = { contentType?: string; width?: number; upsert?: boolean };

/** Construct a public R2 URL from a bucket + path. Must match backend r2PublicUrl(). */
function r2PublicUrl(bucket: string, path: string): string {
  if (path.startsWith("http")) return path;
  const base = (
    (import.meta.env["VITE_R2_PUBLIC_URL"] as string | undefined) ?? ""
  ).replace(/\/$/, "");
  if (!base) return path;
  return `${base}/${bucket}/${path}`;
}

async function ensureFreshToken(): Promise<string | null> {
  let session = (await supabase.auth.getSession()).data.session;
  if (session) {
    const expiresAt = session.expires_at ?? 0;
    if (expiresAt - Math.floor(Date.now() / 1000) < 30) {
      const { data } = await supabase.auth
        .refreshSession()
        .catch(() => ({ data: { session: null } }));
      if (data.session) session = data.session;
    }
  }
  return session?.access_token ?? null;
}

/**
 * Upload a file directly to Cloudflare R2 using a server-minted presigned PUT URL.
 * Works on both native (Capacitor) and web since it's a plain PUT to an HTTPS URL.
 */
async function uploadToR2(
  bucket: string,
  path: string,
  file: File | Blob,
  contentType: string,
  opts?: UploadOptions,
): Promise<void> {
  const { uploadUrl } = await getR2UploadUrl({
    data: { bucket, path, contentType },
  });

  const buffer = await file.arrayBuffer();

  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => window.setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
    try {
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: buffer,
      });
      if (response.ok) return;
      const msg = await response.text().catch(() => `HTTP ${response.status}`);
      const err = Object.assign(new Error(msg), { statusCode: String(response.status) });
      lastError = err;
      if (response.status < 500) throw err;
    } catch (err) {
      if (err === lastError) throw err;
      lastError = err instanceof Error ? err : new Error("Failed to fetch");
    }
  }
  throw lastError;
}

async function uploadObject(
  bucket: string,
  path: string,
  file: File | Blob,
  opts?: UploadOptions,
): Promise<void> {
  const contentType =
    opts?.contentType ?? resolveStoredMime(path, file, undefined) ?? "application/octet-stream";
  return uploadToR2(bucket, path, file, contentType, opts);
}

/** Upload to R2 and return the stored path (not a URL — URL is derived at read time). */
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
 * Upload to R2 and return the public URL immediately.
 * Used by legacy callers that store the URL directly in image_url columns.
 */
export async function uploadAndSign(
  bucket: string,
  path: string,
  file: File | Blob,
  opts?: UploadOptions,
): Promise<string> {
  await uploadObject(bucket, path, file, opts);
  return r2PublicUrl(bucket, path);
}

/** Extract the object path from a plain URL or raw path. */
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

/** Delete objects from R2 after post deletion or upload failure. */
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
  await deleteR2Objects({ data: { bucket, paths } }).catch((err) =>
    console.warn(`[r2] Could not remove ${paths.length} object(s)`, err),
  );
}

// Re-export ensureFreshToken for callers that need a valid JWT for other purposes.
export { ensureFreshToken };
