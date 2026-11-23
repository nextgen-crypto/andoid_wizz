import { describe, it, expect } from "vitest";
import {
  projectDuration,
  clipProjectStart,
  resolvePlayhead,
  adjustToCssFilter,
  DEFAULT_ADJUST,
  type EditorClip,
} from "./editorTypes";

function makeClip(id: string, nativeDuration: number, opts?: Partial<EditorClip>): EditorClip {
  return {
    id,
    file: null as unknown as File,
    src: `blob:test/${id}`,
    nativeDuration,
    trimStart: 0,
    trimEnd: nativeDuration,
    speed: 1,
    volume: 1,
    muted: false,
    filter: "none",
    adjust: { ...DEFAULT_ADJUST },
    keyframes: [],
    cropX: 0,
    cropY: 0,
    cropScale: 1,
    opacity: 1,
    thumbnails: [],
    ...opts,
  };
}

// ─── projectDuration ──────────────────────────────────────────────────────────

describe("projectDuration", () => {
  it("returns 0 for empty clips", () => {
    expect(projectDuration([])).toBe(0);
  });

  it("computes full duration of single clip", () => {
    expect(projectDuration([makeClip("a", 10)])).toBe(10);
  });

  it("respects trim range", () => {
    expect(projectDuration([makeClip("a", 10, { trimStart: 2, trimEnd: 8 })])).toBe(6);
  });

  it("doubles speed halves duration", () => {
    expect(projectDuration([makeClip("a", 10, { speed: 2 })])).toBe(5);
  });

  it("half speed doubles duration", () => {
    expect(projectDuration([makeClip("a", 10, { speed: 0.5 })])).toBe(20);
  });

  it("sums multiple clips", () => {
    expect(projectDuration([makeClip("a", 10), makeClip("b", 5)])).toBe(15);
  });

  it("does not throw or produce Infinity with speed 0 (floor to 0.01)", () => {
    const clip = makeClip("a", 10, { speed: 0 });
    const dur = projectDuration([clip]);
    expect(() => projectDuration([clip])).not.toThrow();
    expect(Number.isFinite(dur)).toBe(true);
    expect(dur).toBe(10 / 0.01); // floor applied
  });

  it("treats inverted trim (start > end) as 0 duration", () => {
    const clip = makeClip("a", 10, { trimStart: 8, trimEnd: 5 });
    expect(projectDuration([clip])).toBe(0);
  });

  it("handles zero nativeDuration clip", () => {
    const clip = makeClip("a", 0, { trimStart: 0, trimEnd: 0 });
    expect(projectDuration([clip])).toBe(0);
  });
});

// ─── clipProjectStart ─────────────────────────────────────────────────────────

describe("clipProjectStart", () => {
  const clips = [makeClip("a", 10), makeClip("b", 5), makeClip("c", 8)];

  it("returns 0 for the first clip", () => {
    expect(clipProjectStart(clips, 0)).toBe(0);
  });

  it("returns duration of first clip for second clip", () => {
    expect(clipProjectStart(clips, 1)).toBe(10);
  });

  it("accumulates durations correctly for third clip", () => {
    expect(clipProjectStart(clips, 2)).toBe(15);
  });

  it("returns total duration for index === clips.length", () => {
    expect(clipProjectStart(clips, 3)).toBe(23);
  });

  it("works with speed-adjusted clips", () => {
    const speedClips = [makeClip("a", 10, { speed: 2 }), makeClip("b", 5)];
    expect(clipProjectStart(speedClips, 1)).toBe(5);
  });
});

// ─── resolvePlayhead ──────────────────────────────────────────────────────────

describe("resolvePlayhead", () => {
  it("returns null for empty clips", () => {
    expect(resolvePlayhead([], 0)).toBeNull();
  });

  it("resolves start of single clip (clipTime = trimStart)", () => {
    const r = resolvePlayhead([makeClip("a", 10)], 0);
    expect(r).not.toBeNull();
    expect(r!.clipIndex).toBe(0);
    expect(r!.clipTime).toBe(0);
  });

  it("resolves middle of single clip", () => {
    const r = resolvePlayhead([makeClip("a", 10)], 5);
    expect(r!.clipIndex).toBe(0);
    expect(r!.clipTime).toBeCloseTo(5);
  });

  it("resolves end of first clip at the exact boundary (inclusive <=)", () => {
    // resolvePlayhead uses `projectTime <= cursor + dur` — the boundary frame
    // belongs to the current clip, not yet the next one.
    const clips = [makeClip("a", 10), makeClip("b", 5)];
    const atEnd = resolvePlayhead(clips, 10);
    expect(atEnd!.clipIndex).toBe(0);
    // just past the boundary advances into clip b
    const justAfter = resolvePlayhead(clips, 10.001);
    expect(justAfter!.clipIndex).toBe(1);
  });

  it("resolves middle of second clip", () => {
    const clips = [makeClip("a", 10), makeClip("b", 5)];
    const r = resolvePlayhead(clips, 12);
    expect(r!.clipIndex).toBe(1);
    expect(r!.clipTime).toBeCloseTo(2);
  });

  it("clamps past-end playhead to last clip", () => {
    const r = resolvePlayhead([makeClip("a", 10)], 999);
    expect(r!.clipIndex).toBe(0);
  });

  it("resolves with trimmed clip — clipTime reflects trimStart offset", () => {
    const clips = [makeClip("a", 10, { trimStart: 2, trimEnd: 8 })];
    const r = resolvePlayhead(clips, 0);
    expect(r!.clipTime).toBeCloseTo(2);
  });

  it("resolves with 2x speed — clipTime advances at double rate", () => {
    const clips = [makeClip("a", 10, { speed: 2 })];
    const r = resolvePlayhead(clips, 2.5);
    expect(r!.clipTime).toBeCloseTo(5);
  });

  it("does not throw with zero-duration clip", () => {
    const clips = [makeClip("a", 0, { trimStart: 0, trimEnd: 0 })];
    expect(() => resolvePlayhead(clips, 0)).not.toThrow();
  });

  it("resolves three clips — correct index across mid-range and past end", () => {
    const clips = [makeClip("a", 4), makeClip("b", 3), makeClip("c", 5)];
    // time 0 → clip a
    expect(resolvePlayhead(clips, 0)!.clipIndex).toBe(0);
    // time 4.001 → into clip b (4 exactly is still clip a due to <= boundary)
    expect(resolvePlayhead(clips, 4.001)!.clipIndex).toBe(1);
    // time 7.001 → into clip c
    expect(resolvePlayhead(clips, 7.001)!.clipIndex).toBe(2);
    // past end → last clip
    expect(resolvePlayhead(clips, 999)!.clipIndex).toBe(2);
  });

  it("negative time resolves to first clip (cursor=0, 0 <= 0+dur)", () => {
    const r = resolvePlayhead([makeClip("a", 10)], -1);
    expect(r!.clipIndex).toBe(0);
  });
});

// ─── adjustToCssFilter ────────────────────────────────────────────────────────

describe("adjustToCssFilter", () => {
  it("returns 'none' for all-zero adjustments and 'none' preset", () => {
    expect(adjustToCssFilter({ ...DEFAULT_ADJUST }, "none")).toBe("none");
  });

  it("applies brightness: +50 → brightness(1.5)", () => {
    const f = adjustToCssFilter({ ...DEFAULT_ADJUST, brightness: 50 }, "none");
    expect(f).toContain("brightness(1.5)");
  });

  it("applies brightness: -100 → brightness(0)", () => {
    const f = adjustToCssFilter({ ...DEFAULT_ADJUST, brightness: -100 }, "none");
    expect(f).toContain("brightness(0)");
  });

  it("applies contrast: -50 → contrast(0.5)", () => {
    const f = adjustToCssFilter({ ...DEFAULT_ADJUST, contrast: -50 }, "none");
    expect(f).toContain("contrast(0.5)");
  });

  it("applies saturation: 100 → saturate(2)", () => {
    const f = adjustToCssFilter({ ...DEFAULT_ADJUST, saturation: 100 }, "none");
    expect(f).toContain("saturate(2)");
  });

  it("applies positive tint → hue-rotate", () => {
    const f = adjustToCssFilter({ ...DEFAULT_ADJUST, tint: 100 }, "none");
    expect(f).toContain("hue-rotate(50deg)");
  });

  it("applies positive temperature → sepia", () => {
    const f = adjustToCssFilter({ ...DEFAULT_ADJUST, temperature: 100 }, "none");
    expect(f).toContain("sepia(0.5)");
  });

  it("applies negative temperature → hue-rotate", () => {
    const f = adjustToCssFilter({ ...DEFAULT_ADJUST, temperature: -100 }, "none");
    expect(f).toContain("hue-rotate(-30deg)");
  });

  it("applies grayscale for 'bw' preset", () => {
    const f = adjustToCssFilter({ ...DEFAULT_ADJUST }, "bw");
    expect(f).toContain("grayscale(1)");
  });

  it("applies sepia for 'warm' preset", () => {
    const f = adjustToCssFilter({ ...DEFAULT_ADJUST }, "warm");
    expect(f).toContain("sepia(0.3)");
  });

  it("applies hue-rotate for 'cool' preset", () => {
    const f = adjustToCssFilter({ ...DEFAULT_ADJUST }, "cool");
    expect(f).toContain("hue-rotate(20deg)");
  });

  it("applies 'chrome' preset high contrast", () => {
    const f = adjustToCssFilter({ ...DEFAULT_ADJUST }, "chrome");
    expect(f).toContain("contrast(1.4)");
  });

  it("combines adjust values with preset", () => {
    const f = adjustToCssFilter({ ...DEFAULT_ADJUST, brightness: 20 }, "bw");
    expect(f).toContain("brightness(1.2)");
    expect(f).toContain("grayscale(1)");
  });

  it("fade > 0 adds opacity filter", () => {
    const f = adjustToCssFilter({ ...DEFAULT_ADJUST, fade: 100 }, "none");
    expect(f).toContain("opacity(");
  });

  it("sharpness > 0 adds contrast proxy", () => {
    const f = adjustToCssFilter({ ...DEFAULT_ADJUST, sharpness: 100 }, "none");
    expect(f).toContain("contrast(");
  });

  it("zero sharpness does not add contrast", () => {
    const f = adjustToCssFilter({ ...DEFAULT_ADJUST, sharpness: 0 }, "none");
    expect(f).not.toContain("contrast(");
  });
});
