export type PostMediaFields = {
  image_url: string | null;
  image_path?: string | null;
  video_url?: string | null;
  video_path?: string | null;
  thumbnail_url?: string | null;
  thumbnail_path?: string | null;
};

function r2PublicUrl(bucket: string, path: string): string {
  if (!path || path.startsWith("http")) return path;
  const base = (
    (import.meta.env["VITE_R2_PUBLIC_URL"] as string | undefined) ?? ""
  ).replace(/\/$/, "");
  if (!base) return path;
  return `${base}/${bucket}/${path}`;
}

/** Replace stored paths with public R2 CDN URLs. Fully synchronous — no network call needed. */
export function hydratePostMediaList<T extends PostMediaFields>(posts: T[]): T[] {
  return posts.map((post) => ({
    ...post,
    image_url: (post.image_path ? r2PublicUrl("post-images", post.image_path) : null) ?? post.image_url,
    video_url: (post.video_path ? r2PublicUrl("post-images", post.video_path) : null) ?? post.video_url,
    thumbnail_url:
      (post.thumbnail_path ? r2PublicUrl("post-images", post.thumbnail_path) : null) ??
      post.thumbnail_url,
  }));
}
