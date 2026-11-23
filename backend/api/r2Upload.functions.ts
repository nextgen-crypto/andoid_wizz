import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { r2PresignedPutUrl, r2DeleteObjects } from "@/backend/lib/r2";

/** Returns a presigned PUT URL so the client can upload a file directly to R2. */
export const getR2UploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (data: { bucket?: string; path?: string; contentType?: string } | undefined) => ({
      bucket: (data?.bucket ?? "").trim(),
      path: (data?.path ?? "").trim(),
      contentType: (data?.contentType ?? "application/octet-stream").trim(),
    }),
  )
  .handler(async ({ context, data }): Promise<{ uploadUrl: string; publicUrl: string }> => {
    const { userId } = context as unknown as { userId: string };
    if (!data.bucket || !data.path) throw new Error("bucket and path are required");

    // Enforce that the path is scoped to the authenticated user's folder.
    if (!data.path.startsWith(`${userId}/`)) {
      throw new Error("Upload path must be within your own folder.");
    }

    const { r2PublicUrl } = await import("@/backend/lib/r2");
    const uploadUrl = await r2PresignedPutUrl(data.bucket, data.path, data.contentType);
    const publicUrl = r2PublicUrl(data.bucket, data.path);
    return { uploadUrl, publicUrl };
  });

/** Delete objects from R2 — called after post deletion or failed uploads. */
export const deleteR2Objects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (data: { bucket?: string; paths?: string[] } | undefined) => ({
      bucket: (data?.bucket ?? "").trim(),
      paths: (data?.paths ?? []).filter((p): p is string => typeof p === "string"),
    }),
  )
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    const { userId } = context as unknown as { userId: string };
    // Only allow deleting objects in the caller's folder.
    const allowed = data.paths.filter((p) => p.startsWith(`${userId}/`));
    if (allowed.length > 0) {
      await r2DeleteObjects(data.bucket, allowed);
    }
    return { ok: true };
  });
