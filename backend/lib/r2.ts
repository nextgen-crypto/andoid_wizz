import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";

function r2Client(): S3Client {
  const accountId = process.env["R2_ACCOUNT_ID"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing R2 credentials: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export function r2BucketName(): string {
  return process.env["R2_BUCKET"] ?? "wizz-media";
}

/** R2 object key: {supabaseBucket}/{path} keeps the existing path conventions. */
export function r2Key(bucket: string, path: string): string {
  return `${bucket}/${path}`;
}

/**
 * Public CDN URL for a stored object.
 * VITE_R2_PUBLIC_URL must be the R2 public bucket URL, e.g.:
 *   https://pub-xxxx.r2.dev  (R2 managed public access)
 *   https://media.yourdomain.com  (custom domain via Cloudflare)
 */
export function r2PublicUrl(bucket: string, path: string): string {
  if (path.startsWith("http")) return path;
  const base =
    (process.env["VITE_R2_PUBLIC_URL"] ?? process.env["R2_PUBLIC_URL"] ?? "").replace(/\/$/, "");
  if (!base) return path;
  return `${base}/${r2Key(bucket, path)}`;
}

/** Generate a short-lived presigned PUT URL so the client can upload directly to R2. */
export async function r2PresignedPutUrl(
  supabaseBucket: string,
  path: string,
  contentType: string,
  expiresIn = 300,
): Promise<string> {
  const client = r2Client();
  const command = new PutObjectCommand({
    Bucket: r2BucketName(),
    Key: r2Key(supabaseBucket, path),
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn });
}

/** Delete objects from R2 in one batch call. */
export async function r2DeleteObjects(supabaseBucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const client = r2Client();
  await client.send(
    new DeleteObjectsCommand({
      Bucket: r2BucketName(),
      Delete: {
        Objects: paths.map((p) => ({ Key: r2Key(supabaseBucket, p) })),
        Quiet: true,
      },
    }),
  );
}
