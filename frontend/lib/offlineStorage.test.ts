import { describe, expect, it } from "vitest";

import { collectMediaUrls } from "./offlineStorage";

describe("collectMediaUrls", () => {
  it("keeps image URLs and skips videos or ambiguous storage paths", () => {
    const urls = collectMediaUrls({
      imageUrl: "https://cdn.example/storage/v1/object/public/posts/a.jpg",
      videoUrl: "https://cdn.example/storage/v1/object/public/posts/a.mp4",
      posterUrl: "https://cdn.example/storage/v1/object/public/posts/poster",
      avatar_url: "https://cdn.example/avatars/me",
      src: "https://cdn.example/storage/v1/object/public/posts/ambiguous",
      media: {
        mediaType: "video",
        mediaUrl: "https://cdn.example/storage/v1/object/public/posts/clip",
      },
      story: {
        mediaType: "image",
        mediaUrl: "https://cdn.example/storage/v1/object/public/stories/still",
      },
    });

    expect(urls).toEqual([
      "https://cdn.example/storage/v1/object/public/posts/a.jpg",
      "https://cdn.example/storage/v1/object/public/posts/poster",
      "https://cdn.example/avatars/me",
      "https://cdn.example/storage/v1/object/public/stories/still",
    ]);
  });
});
