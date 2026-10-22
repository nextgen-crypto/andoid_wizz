import { describe, expect, it } from "vitest";
import {
  classifyVideoOrientation,
  extOf,
  friendlyPublishError,
  keepOriginal,
  mimeMismatch,
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
    const raw =
      'invalid input syntax for type uuid: "not-a-uuid"';
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

  it("maps oversized payloads to the size limit", () => {
    expect(friendlyPublishError(new Error("Payload too large"))).toBe(
      "Videos must be under 200 MB.",
    );
  });

  it("maps missing columns to the migration message", () => {
    expect(
      friendlyPublishError(
        new Error('column "video_path" does not exist'),
      ),
    ).toBe("Video posting needs the latest Supabase migration before it can be saved.");
  });

  it("passes short human sentences through untouched", () => {
    expect(friendlyPublishError(new Error("Scheduling needs a migration."))).toBe(
      "Scheduling needs a migration.",
    );
  });

  it("falls back for empty or SQL-shaped errors", () => {
    expect(friendlyPublishError(undefined)).toBe("Could not publish. Try again.");
    expect(friendlyPublishError(new Error("PGRST204 {\"details\":null}"))).toBe(
      "Could not publish. Try again.",
    );
  });
});
