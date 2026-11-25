import { supabase } from "@/integrations/supabase/client";
import { resolveStoredMime } from "@/frontend/lib/mediaFormat";
import { deleteR2Objects, uploadFileViaServer } from "@/backend/api/r2Upload.functions";

export const MEDIA_URL_TTL_SECONDS = 24 * 60 * 60;

type UploadOptions = { contentType?: string; width?: number; upsert?: boolean };

/** Construct a public R2 URL from a bucket + path. Must match backend r2PublicUrl(). */
function r2PublicUrl(bucket: string, path: string): string {
  if (path.startsWith("http")) return path;
  const base = ((import.meta.env["VITE_R2_PUBLIC_URL"] as string | undefined) ?? "").replace(
    /\/$/,
    "",
  );
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
 * Upload a file to Cloudflare R2.
 *
 * On native (Android WebView origin = https://localhost) a presigned PUT hits a
 * CORS block, so we route through a server function that uploads with its own
 * credentials — no CORS involved. On web we use the presigned URL directly.
 */
async function uploadToR2(
  bucket: string,
  path: string,
  file: File | Blob,
  contentType: string,
  opts?: UploadOptions,
): Promise<void> {
  // Route every upload through the server function so the server's own
  // R2 credentials are used — no CORS preflight from the browser, works
  // identically on web and native.
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
  await uploadFileViaServer({ data: { bucket, path, contentType, b64: btoa(binary) } });
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
