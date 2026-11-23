// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from "vitest";
import { useEditorStore } from "./editorStore";
import {
  DEFAULT_ADJUST,
  type EditorClip,
  type TextLayer,
  type StickerLayer,
} from "@/frontend/lib/editorTypes";

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

function makeTextLayer(id: string, overrides?: Partial<TextLayer>): TextLayer {
  return {
    id,
    text: "Hello",
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    color: "#fff",
    fontSize: 20,
    bold: false,
    italic: false,
    align: "center",
    bg: "none",
    animIn: "none",
    animOut: "none",
    startTime: 0,
    endTime: 5,
    ...overrides,
  };
}

function makeSticker(id: string, overrides?: Partial<StickerLayer>): StickerLayer {
  return {
    id,
    emoji: "😍",
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    startTime: 0,
    endTime: 3,
    ...overrides,
  };
}

const store = () => useEditorStore.getState();

beforeEach(() => {
  store().resetProject();
  localStorage.clear();
});

// ─── addClip / removeClip ─────────────────────────────────────────────────────

describe("addClip / removeClip", () => {
  it("addClip appends to clips", () => {
    store().addClip(makeClip("a", 10));
    expect(store().project.clips).toHaveLength(1);
    expect(store().project.clips[0]!.id).toBe("a");
  });

  it("adds multiple clips in order", () => {
    store().addClip(makeClip("a", 10));
    store().addClip(makeClip("b", 5));
    expect(store().project.clips.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("removeClip removes the correct clip by id", () => {
    store().addClip(makeClip("a", 10));
    store().addClip(makeClip("b", 5));
    store().removeClip("a");
    const { clips } = store().project;
    expect(clips).toHaveLength(1);
    expect(clips[0]!.id).toBe("b");
  });

  it("removeClip with unknown id is a no-op", () => {
    store().addClip(makeClip("a", 10));
    store().removeClip("does-not-exist");
    expect(store().project.clips).toHaveLength(1);
  });

  it("removeClip from empty array does not throw", () => {
    expect(() => store().removeClip("x")).not.toThrow();
  });
});

// ─── updateClip ───────────────────────────────────────────────────────────────

describe("updateClip", () => {
  it("updates only the specified fields", () => {
    store().addClip(makeClip("a", 10));
    store().updateClip("a", { volume: 0.5 });
    const clip = store().project.clips[0]!;
    expect(clip.volume).toBe(0.5);
    expect(clip.speed).toBe(1);
  });

  it("can update muted flag", () => {
    store().addClip(makeClip("a", 10));
    store().updateClip("a", { muted: true });
    expect(store().project.clips[0]!.muted).toBe(true);
  });

  it("updateClip with unknown id is a no-op", () => {
    store().addClip(makeClip("a", 10));
    store().updateClip("does-not-exist", { volume: 0 });
    expect(store().project.clips[0]!.volume).toBe(1);
  });
});

// ─── reorderClips ─────────────────────────────────────────────────────────────

describe("reorderClips", () => {
  it("moves clip from index 0 to 1", () => {
    store().addClip(makeClip("a", 10));
    store().addClip(makeClip("b", 5));
    store().reorderClips(0, 1);
    expect(store().project.clips.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("moves last clip to front", () => {
    store().addClip(makeClip("a", 10));
    store().addClip(makeClip("b", 5));
    store().addClip(makeClip("c", 3));
    store().reorderClips(2, 0);
    expect(store().project.clips[0]!.id).toBe("c");
  });

  it("does not crash with out-of-bounds source index", () => {
    store().addClip(makeClip("a", 10));
    expect(() => store().reorderClips(99, 0)).not.toThrow();
  });
});

// ─── splitClipAt ──────────────────────────────────────────────────────────────

describe("splitClipAt", () => {
  it("splits a clip into two at the given project time", () => {
    store().addClip(makeClip("a", 10));
    store().splitClipAt("a", 5);
    const clips = store().project.clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]!.trimEnd).toBeCloseTo(5);
    expect(clips[1]!.trimStart).toBeCloseTo(5);
  });

  it("both halves reference the same source", () => {
    store().addClip(makeClip("a", 10));
    store().splitClipAt("a", 4);
    const [left, right] = store().project.clips;
    expect(left!.src).toBe(right!.src);
  });

  it("is a no-op when splitAt equals trimStart", () => {
    store().addClip(makeClip("a", 10, { trimStart: 5 }));
    // projectTime 0 → offsetInClip = 0 * speed = 0 → splitAt = trimStart = 5 → no-op
    store().splitClipAt("a", 0);
    expect(store().project.clips).toHaveLength(1);
  });

  it("is a no-op when splitAt equals trimEnd", () => {
    store().addClip(makeClip("a", 10));
    store().splitClipAt("a", 10); // right at trimEnd
    expect(store().project.clips).toHaveLength(1);
  });

  it("is a no-op for unknown clip id", () => {
    store().addClip(makeClip("a", 10));
    store().splitClipAt("does-not-exist", 5);
    expect(store().project.clips).toHaveLength(1);
  });

  it("does not throw on empty clips array", () => {
    expect(() => store().splitClipAt("a", 5)).not.toThrow();
  });

  it("splits second clip at correct offset when first clip precedes it", () => {
    store().addClip(makeClip("a", 10));
    store().addClip(makeClip("b", 10));
    // project time 15 is 5s into clip b
    store().splitClipAt("b", 15);
    const clips = store().project.clips;
    expect(clips).toHaveLength(3);
    expect(clips[1]!.trimEnd).toBeCloseTo(5);
    expect(clips[2]!.trimStart).toBeCloseTo(5);
  });
});

// ─── undo / redo ──────────────────────────────────────────────────────────────

describe("undo / redo", () => {
  it("canUndo is false on fresh store", () => {
    expect(store().canUndo()).toBe(false);
  });

  it("canUndo is true after a mutation", () => {
    store().addClip(makeClip("a", 10));
    expect(store().canUndo()).toBe(true);
  });

  it("undo reverts addClip", () => {
    store().addClip(makeClip("a", 10));
    store().undo();
    expect(store().project.clips).toHaveLength(0);
  });

  it("redo re-applies the undone mutation", () => {
    store().addClip(makeClip("a", 10));
    store().undo();
    store().redo();
    expect(store().project.clips).toHaveLength(1);
    expect(store().project.clips[0]!.id).toBe("a");
  });

  it("canRedo is false on fresh store", () => {
    expect(store().canRedo()).toBe(false);
  });

  it("canRedo is true after undo", () => {
    store().addClip(makeClip("a", 10));
    store().undo();
    expect(store().canRedo()).toBe(true);
  });

  it("new mutation clears the redo stack", () => {
    store().addClip(makeClip("a", 10));
    store().undo();
    store().addClip(makeClip("b", 5));
    expect(store().canRedo()).toBe(false);
  });

  it("multi-level undo/redo", () => {
    store().addClip(makeClip("a", 10));
    store().addClip(makeClip("b", 5));
    store().undo();
    store().undo();
    expect(store().project.clips).toHaveLength(0);
    store().redo();
    store().redo();
    expect(store().project.clips).toHaveLength(2);
  });

  it("undo is a no-op when history is empty", () => {
    expect(() => store().undo()).not.toThrow();
    expect(store().project.clips).toHaveLength(0);
  });

  it("redo is a no-op when future is empty", () => {
    expect(() => store().redo()).not.toThrow();
  });
});

// ─── setPlayhead ─────────────────────────────────────────────────────────────

describe("setPlayhead", () => {
  it("clamps negative values to 0", () => {
    store().setPlayhead(-5);
    expect(store().playhead).toBe(0);
  });

  it("clamps to 0 when no clips exist", () => {
    store().setPlayhead(999);
    expect(store().playhead).toBe(0);
  });

  it("clamps to project duration with clips", () => {
    store().addClip(makeClip("a", 10));
    store().setPlayhead(999);
    expect(store().playhead).toBe(10);
  });

  it("sets valid time within duration", () => {
    store().addClip(makeClip("a", 10));
    store().setPlayhead(5);
    expect(store().playhead).toBe(5);
  });

  it("sets to exactly 0", () => {
    store().setPlayhead(0);
    expect(store().playhead).toBe(0);
  });
});

// ─── setZoom ──────────────────────────────────────────────────────────────────

describe("setZoom", () => {
  it("clamps to minimum 20", () => {
    store().setZoom(1);
    expect(store().zoom).toBe(20);
  });

  it("clamps to maximum 300", () => {
    store().setZoom(10000);
    expect(store().zoom).toBe(300);
  });

  it("sets valid values", () => {
    store().setZoom(100);
    expect(store().zoom).toBe(100);
  });

  it("sets minimum boundary exactly", () => {
    store().setZoom(20);
    expect(store().zoom).toBe(20);
  });
});

// ─── selectClip / sheet management ───────────────────────────────────────────

describe("selectClip / sheet management", () => {
  it("selectClip sets selectedClipId", () => {
    store().selectClip("clip-123");
    expect(store().selectedClipId).toBe("clip-123");
  });

  it("selectClip with null deselects", () => {
    store().selectClip("clip-123");
    store().selectClip(null);
    expect(store().selectedClipId).toBeNull();
  });

  it("openSheet sets activeSheet", () => {
    store().openSheet("adjust");
    expect(store().activeSheet).toBe("adjust");
  });

  it("closeSheet resets activeSheet to null", () => {
    store().openSheet("adjust");
    store().closeSheet();
    expect(store().activeSheet).toBeNull();
  });

  it("openSheet can open export sheet", () => {
    store().openSheet("export");
    expect(store().activeSheet).toBe("export");
  });
});

// ─── dirty flag ───────────────────────────────────────────────────────────────

describe("dirty flag", () => {
  it("starts as false", () => {
    expect(store().dirty).toBe(false);
  });

  it("becomes true after addClip", () => {
    store().addClip(makeClip("a", 10));
    expect(store().dirty).toBe(true);
  });

  it("becomes true after updateClip", () => {
    store().addClip(makeClip("a", 10));
    store().resetProject(); // reset dirty
    store().addClip(makeClip("a", 10));
    store().updateClip("a", { volume: 0.5 });
    expect(store().dirty).toBe(true);
  });

  it("resets to false after resetProject", () => {
    store().addClip(makeClip("a", 10));
    store().resetProject();
    expect(store().dirty).toBe(false);
  });
});

// ─── text layers ─────────────────────────────────────────────────────────────

describe("text layers", () => {
  it("addTextLayer appends", () => {
    store().addTextLayer(makeTextLayer("t1"));
    expect(store().project.textLayers).toHaveLength(1);
  });

  it("addTextLayer twice appends both", () => {
    store().addTextLayer(makeTextLayer("t1"));
    store().addTextLayer(makeTextLayer("t2"));
    expect(store().project.textLayers).toHaveLength(2);
  });

  it("updateTextLayer updates only specified fields", () => {
    store().addTextLayer(makeTextLayer("t1", { text: "Hi", x: 0.5 }));
    store().updateTextLayer("t1", { text: "Bye" });
    const layer = store().project.textLayers[0]!;
    expect(layer.text).toBe("Bye");
    expect(layer.x).toBe(0.5);
  });

  it("updateTextLayer with unknown id is a no-op", () => {
    store().addTextLayer(makeTextLayer("t1"));
    store().updateTextLayer("does-not-exist", { text: "X" });
    expect(store().project.textLayers[0]!.text).toBe("Hello");
  });

  it("removeTextLayer removes by id", () => {
    store().addTextLayer(makeTextLayer("t1"));
    store().addTextLayer(makeTextLayer("t2"));
    store().removeTextLayer("t1");
    expect(store().project.textLayers).toHaveLength(1);
    expect(store().project.textLayers[0]!.id).toBe("t2");
  });
});

// ─── stickers ────────────────────────────────────────────────────────────────

describe("stickers", () => {
  it("addSticker appends", () => {
    store().addSticker(makeSticker("s1"));
    expect(store().project.stickers).toHaveLength(1);
  });

  it("updateSticker updates position", () => {
    store().addSticker(makeSticker("s1", { x: 0.5, y: 0.5 }));
    store().updateSticker("s1", { x: 0.8, y: 0.2 });
    const sk = store().project.stickers[0]!;
    expect(sk.x).toBeCloseTo(0.8);
    expect(sk.y).toBeCloseTo(0.2);
  });

  it("removeSticker removes by id", () => {
    store().addSticker(makeSticker("s1"));
    store().removeSticker("s1");
    expect(store().project.stickers).toHaveLength(0);
  });

  it("removeSticker with unknown id is a no-op", () => {
    store().addSticker(makeSticker("s1"));
    store().removeSticker("does-not-exist");
    expect(store().project.stickers).toHaveLength(1);
  });
});

// ─── global filter / adjust ───────────────────────────────────────────────────

describe("setGlobalFilter / setGlobalAdjust", () => {
  it("setGlobalFilter updates globalFilter", () => {
    store().setGlobalFilter("bw");
    expect(store().project.globalFilter).toBe("bw");
  });

  it("setGlobalAdjust updates globalAdjust", () => {
    store().setGlobalAdjust({ ...DEFAULT_ADJUST, brightness: 50 });
    expect(store().project.globalAdjust.brightness).toBe(50);
  });
});

// ─── setSoundTrack ────────────────────────────────────────────────────────────

describe("setSoundTrack", () => {
  it("sets a sound track", () => {
    store().setSoundTrack({
      id: "s1",
      title: "Test",
      artist: "Artist",
      duration: 60,
      src: "https://example.com/audio.mp3",
      startOffset: 0,
      volume: 1,
    });
    expect(store().project.soundTrack?.id).toBe("s1");
  });

  it("clears sound track with null", () => {
    store().setSoundTrack({
      id: "s1",
      title: "Test",
      artist: "Artist",
      duration: 60,
      src: "https://example.com/audio.mp3",
      startOffset: 0,
      volume: 1,
    });
    store().setSoundTrack(null);
    expect(store().project.soundTrack).toBeNull();
  });
});

// ─── autosave / loadAutosave ──────────────────────────────────────────────────

describe("autosave / loadAutosave", () => {
  it("autosave does not throw", () => {
    store().addClip(makeClip("a", 10));
    expect(() => store().autosave()).not.toThrow();
  });

  it("loadAutosave returns false when nothing saved", () => {
    expect(store().loadAutosave()).toBe(false);
  });

  it("loadAutosave returns false for corrupt JSON", () => {
    localStorage.setItem("wizz:editor:autosave", "{ not: valid json");
    expect(store().loadAutosave()).toBe(false);
  });

  it("loadAutosave returns false for JSON with no meaningful fields", () => {
    localStorage.setItem("wizz:editor:autosave", JSON.stringify({ clips: [] }));
    expect(store().loadAutosave()).toBe(false);
  });

  it("round-trips globalFilter via autosave/loadAutosave", () => {
    store().setGlobalFilter("warm");
    store().autosave();
    store().resetProject();
    const loaded = store().loadAutosave();
    expect(loaded).toBe(true);
    expect(store().project.globalFilter).toBe("warm");
  });

  it("round-trips textLayers via autosave/loadAutosave", () => {
    store().addTextLayer(makeTextLayer("t1", { text: "WIZZ" }));
    store().autosave();
    store().resetProject();
    store().loadAutosave();
    expect(store().project.textLayers[0]!.text).toBe("WIZZ");
  });

  it("round-trips stickers via autosave/loadAutosave", () => {
    store().addSticker(makeSticker("s1", { emoji: "🔥" }));
    store().autosave();
    store().resetProject();
    store().loadAutosave();
    expect(store().project.stickers[0]!.emoji).toBe("🔥");
  });

  it("clips are empty after loadAutosave (File objects cannot be serialized)", () => {
    store().addClip(makeClip("a", 10));
    store().addTextLayer(makeTextLayer("t1")); // need a meaningful field to trigger load
    store().autosave();
    store().resetProject();
    store().loadAutosave();
    expect(store().project.clips).toHaveLength(0);
  });
});

// ─── resetProject ─────────────────────────────────────────────────────────────

describe("resetProject", () => {
  it("clears all clips, text layers, and stickers", () => {
    store().addClip(makeClip("a", 10));
    store().addTextLayer(makeTextLayer("t1"));
    store().addSticker(makeSticker("s1"));
    store().resetProject();
    const { project } = store();
    expect(project.clips).toHaveLength(0);
    expect(project.textLayers).toHaveLength(0);
    expect(project.stickers).toHaveLength(0);
  });

  it("resets playhead to 0", () => {
    store().addClip(makeClip("a", 10));
    store().setPlayhead(5);
    store().resetProject();
    expect(store().playhead).toBe(0);
  });

  it("resets selectedClipId to null", () => {
    store().selectClip("clip-id");
    store().resetProject();
    expect(store().selectedClipId).toBeNull();
  });

  it("clears history and future", () => {
    store().addClip(makeClip("a", 10));
    store().resetProject();
    expect(store().canUndo()).toBe(false);
    expect(store().canRedo()).toBe(false);
  });

  it("accepts a custom project to reset to", () => {
    store().addClip(makeClip("a", 10));
    const custom = { ...store().project, globalFilter: "bw" as const };
    store().resetProject(custom);
    expect(store().project.globalFilter).toBe("bw");
    expect(store().project.clips).toHaveLength(1); // custom project kept
  });
});
