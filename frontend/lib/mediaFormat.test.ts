import { describe, expect, it, vi } from "vitest";
import {
  bakeOrOriginal,
  classifyVideoOrientation,
  extOf,
  friendlyPublishError,
  keepOriginal,
  mediaKindForExt,
  mimeMismatch,
  probeVideoMetadata,
  resolveStoredMime,
  resolveUploadMime,
  videoPreviewable,
} from "@/frontend/lib/mediaFormat";

/** jsdom's `<video>` never decodes; canPlayType there returns "". That is
 *  exactly the environment where the extension allowlist must carry the
 *  decision, which is what these tests pin down. */

function file(name: string, type: string): File {
  return new File([""], name, { type });
}

describe("mimeMismatch — the preview gate that used to dead-end Android picks", () => {
  it("accepts real containers that providers mislabel as application/*", () => {
    expect(mimeMismatch(file("clip.mp4", "application/mp4"), "video")).toBe(false);
    expect(mimeMismatch(file("clip.mov", "application/quicktime"), "video")).toBe(false);
    expect(mimeMismatch(file("clip.mkv", "application/x-matroska"), "video")).toBe(false);
    expect(mimeMismatch(file("clip.mp4", "application/octet-stream"), "video")).toBe(false);
  });

  it("accepts correctly labelled videos", () => {
    expect(mimeMismatch(file("clip.mp4", "video/mp4"), "video")).toBe(false);
    expect(mimeMismatch(file("clip.webm", "video/webm"), "video")).toBe(false);
    expect(mimeMismatch(file("clip.3gp", "video/3gpp"), "video")).toBe(false);
  });

  it("accepts picks with no MIME at all when the extension is known", () => {
    expect(mimeMismatch(file("clip.mp4", ""), "video")).toBe(false);
    expect(mimeMismatch(file("clip.mov", ""), "video")).toBe(false);
    expect(mimeMismatch(file("photo.heic", ""), "image")).toBe(false);
  });

  it("does not block unknown extensions — the decode probe decides", () => {
    expect(mimeMismatch(file("clip", ""), "video")).toBe(false);
    expect(mimeMismatch(file("clip", "application/octet-stream"), "video")).toBe(false);
  });

  it("still rejects picks that positively name another kind", () => {
    expect(mimeMismatch(file("photo.jpg", "image/jpeg"), "video")).toBe(true);
    expect(mimeMismatch(file("song.mp3", "audio/mpeg"), "video")).toBe(true);
    expect(mimeMismatch(file("doc.pdf", "application/pdf"), "image")).toBe(true);
    expect(mimeMismatch(file("clip.mp4", "video/mp4"), "image")).toBe(true);
    expect(mimeMismatch(file("notes.txt", "text/plain"), "image")).toBe(true);
  });
});

describe("videoPreviewable", () => {
  it("keeps common containers previewable even when canPlayType is empty", () => {
    for (const name of ["a.mp4", "a.m4v", "a.mov", "a.webm", "a.ogv", "a.3gp"]) {
      expect(videoPreviewable(file(name, ""))).toBe(true);
    }
  });

  it("allows a positively-playable MIME", () => {
    // jsdom cannot answer, but the function must consult canPlayType first.
    expect(videoPreviewable(file("clip.bin", "video/mp4"))).toBe(true);
  });
});

describe("extOf / keepOriginal", () => {
  it("prefers the filename extension over the MIME subtype", () => {
    expect(extOf(file("CLIP.MP4", "application/mp4"))).toBe("mp4");
    expect(extOf(file("archive.tar.gz", ""))).toBe("gz");
  });

  it("never bakes animated/vector formats", () => {
    expect(keepOriginal(file("a.gif", "image/gif"))).toBe(true);
    expect(keepOriginal(file("a.svg", "image/svg+xml"))).toBe(true);
    expect(keepOriginal(file("a.jpg", "image/jpeg"))).toBe(false);
  });
});

describe("classifyVideoOrientation", () => {
  it("files portrait to Shorts and landscape/square to Videos", () => {
    expect(classifyVideoOrientation(720, 1280)).toBe("short");
    expect(classifyVideoOrientation(1920, 1080)).toBe("video");
    expect(classifyVideoOrientation(1000, 1000)).toBe("video");
    expect(classifyVideoOrientation(0, 0)).toBe("video");
  });
});

describe("friendlyPublishError — raw database prose must never reach the screen", () => {
  it("replaces the raw 'invalid …' database messages with calm text", () => {
    const raw = 'invalid input syntax for type uuid: "not-a-uuid"';
    expect(friendlyPublishError(new Error(raw))).toBe("Could not publish. Try again.");
  });

  it("maps RLS rejections to a permission message", () => {
    expect(friendlyPublishError(new Error("new row violates row-level security policy"))).toBe(
      "You don't have permission to publish this.",
    );
  });

  it("maps network failures to an offline message", () => {
    expect(friendlyPublishError(new TypeError("Failed to fetch"))).toBe(
      "No internet connection. Check your network and retry.",
    );
  });

  it("maps oversized payloads without blaming the wrong format", () => {
    // "exceeded" used to route photo failures to the *video* size message.
    expect(friendlyPublishError(new Error("Payload too large"))).toBe(
      "That file is too large to upload.",
    );
    expect(friendlyPublishError(new Error("The object exceeded the maximum allowed size"))).toBe(
      "That file is too large to upload.",
    );
  });

  it("maps MIME rejections to an actionable format message", () => {
    expect(friendlyPublishError(new Error("mime type video/quicktime is not supported"))).toBe(
      "This file type isn't accepted for upload. Try an MP4 or JPEG.",
    );
    expect(friendlyPublishError(new Error('{"statusCode":415}'))).toBe(
      "This file type isn't accepted for upload. Try an MP4 or JPEG.",
    );
  });

  it("reads a real 401 but never four hex digits", () => {
    expect(friendlyPublishError(new Error('{"status":401}'))).toBe(
      "Your session expired. Sign in again and retry.",
    );
    // "f401a2b3" contains "401" — substring matching used to fake this error.
    expect(friendlyPublishError(new Error("invalid token f401a2b3 deadbeef"))).not.toBe(
      "Your session expired. Sign in again and retry.",
    );
  });

  it("maps missing columns to the migration message", () => {
    expect(friendlyPublishError(new Error('column "video_path" does not exist'))).toBe(
      "Video posting needs the latest Supabase migration before it can be saved.",
    );
  });

  it("passes short human sentences through untouched", () => {
    expect(friendlyPublishError(new Error("Scheduling needs a migration."))).toBe(
      "Scheduling needs a migration.",
    );
  });

  it("falls back for empty or SQL-shaped errors", () => {
    expect(friendlyPublishError(undefined)).toBe("Could not publish. Try again.");
    expect(friendlyPublishError(new Error('PGRST204 {"details":null}'))).toBe(
      "Could not publish. Try again.",
    );
  });
});

describe("resolveUploadMime — never forward empty/application/* types to Storage", () => {
  it("prefers a correct kind-matching file.type", () => {
    expect(resolveUploadMime(file("clip.mp4", "video/mp4"), "video", "mp4")).toBe("video/mp4");
    expect(resolveUploadMime(file("photo.png", "image/png"), "image", "png")).toBe("image/png");
  });

  it("falls back to the extension when the type is missing or application/*", () => {
    expect(resolveUploadMime(file("clip.mov", "application/quicktime"), "video", "mov")).toBe(
      "video/quicktime",
    );
    expect(resolveUploadMime(file("clip.mp4", ""), "video", "mp4")).toBe("video/mp4");
    expect(resolveUploadMime(file("clip.mkv", "application/octet-stream"), "video", "mkv")).toBe(
      "video/x-matroska",
    );
    expect(resolveUploadMime(file("photo.jpg", ""), "image", "jpg")).toBe("image/jpeg");
  });

  it("always resolves to a real kind/* type for unknown inputs", () => {
    expect(resolveUploadMime(file("clip", ""), "video", "")).toBe("video/mp4");
    expect(resolveUploadMime(file("photo", "application/octet-stream"), "image", "xyz")).toBe(
      "image/jpeg",
    );
    // The old fallback built `video/${ext}` — an invented type, never this.
    expect(resolveUploadMime(file("clip.mov", "application/mp4"), "video", "mov")).not.toBe(
      "video/mov",
    );
  });
});

describe("probeVideoMetadata — Android builds that fire neither event", () => {
  it("resolves null at the 8s deadline instead of hanging forever", async () => {
    vi.useFakeTimers();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:probe";
    URL.revokeObjectURL = () => {};
    try {
      const pending = probeVideoMetadata(file("clip.mp4", "video/mp4"));
      await vi.advanceTimersByTimeAsync(8000);
      expect(await pending).toBeNull();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      vi.useRealTimers();
    }
  });
});

describe("bakeOrOriginal — publish must never freeze on a stuck bake", () => {
  it("returns the bake result untouched when it settles in time", async () => {
    const baked = new Blob(["baked"], { type: "image/jpeg" });
    const out = await bakeOrOriginal(file("shot.jpg", "image/jpeg"), async () => baked);
    expect(out).toBe(baked);
  });

  it("falls back to the original file when the bake rejects", async () => {
    const original = file("shot.jpg", "image/jpeg");
    const out = await bakeOrOriginal(original, async () => {
      throw new Error("decode failed");
    });
    expect(out).toBe(original);
  });

  it("falls back to the original at the deadline when the bake never settles", async () => {
    vi.useFakeTimers();
    const original = file("shot.jpg", "image/jpeg");
    try {
      const pending = bakeOrOriginal(original, () => new Promise<Blob>(() => undefined));
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await pending).toBe(original);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never touches formats that must stay verbatim", async () => {
    const gif = file("anim.gif", "image/gif");
    const bake = vi.fn(async () => new Blob(["x"], { type: "image/jpeg" }));
    expect(await bakeOrOriginal(gif, bake)).toBe(gif);
    expect(bake).not.toHaveBeenCalled();
  });
});

describe("friendlyPublishError — call-site-specific fallback wording", () => {
  it("uses the provided fallback instead of the publish sentence", () => {
    expect(friendlyPublishError(new Error('PGRST204 {"details":null}'), "Upload failed.")).toBe(
      "Upload failed.",
    );
    expect(friendlyPublishError(undefined, "Could not upload that picture.")).toBe(
      "Could not upload that picture.",
    );
    // Known families still map to their own copy regardless of the fallback.
    expect(friendlyPublishError(new Error("Payload too large"), "Upload failed.")).toBe(
      "That file is too large to upload.",
    );
  });
});

describe("mediaKindForExt — object paths are the label when the File is not", () => {
  it("maps extensions through the canonical MIME table", () => {
    expect(mediaKindForExt("jpg")).toBe("image");
    expect(mediaKindForExt("png")).toBe("image");
    expect(mediaKindForExt("PNG")).toBe("image");
    expect(mediaKindForExt("mp4")).toBe("video");
    expect(mediaKindForExt("mov")).toBe("video");
  });

  it("returns null for extensions outside the media maps", () => {
    expect(mediaKindForExt("")).toBeNull();
    expect(mediaKindForExt("bin")).toBeNull();
    expect(mediaKindForExt("json")).toBeNull();
  });
});

describe("resolveStoredMime — one wrapper for every storage call site", () => {
  it("lets an explicit caller value win", () => {
    expect(resolveStoredMime("u/post-a.webp", file("a.png", "image/png"), "image/webp")).toBe(
      "image/webp",
    );
  });

  it("uses the object path extension when the File arrives untyped", () => {
    expect(resolveStoredMime("u/post-a.mp4", file("clip", ""))).toBe("video/mp4");
    expect(resolveStoredMime("u/avatar-a.jpg", file("me", ""))).toBe("image/jpeg");
    // An application/* label from an Android provider never reaches Storage.
    expect(resolveStoredMime("u/post-a.mov", file("clip", "application/quicktime"))).toBe(
      "video/quicktime",
    );
  });

  it("prefers a kind-matching file.type over the path extension", () => {
    expect(resolveStoredMime("u/post-a.jpg", file("a.png", "image/png"))).toBe("image/png");
    expect(resolveStoredMime("u/post-a.jpg", file("a.jpg", "image/jpeg"))).toBe("image/jpeg");
  });

  it("falls through unchanged when nothing identifies the media", () => {
    expect(resolveStoredMime("u/export.json", new Blob(["{}"], { type: "application/json" }))).toBe(
      "application/json",
    );
    expect(resolveStoredMime("u/blob", new Blob(["x"]))).toBeUndefined();
  });
});
