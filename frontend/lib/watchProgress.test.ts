// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWatchProgress,
  getContinueWatching,
  getWatchProgress,
  saveWatchProgress,
} from "./watchProgress";

const USER = "user-1";
const BASE = new Date("2026-10-20T12:00:00.000Z").getTime();

describe("watchProgress", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records nothing for a glance", () => {
    saveWatchProgress(USER, "vid-1", 2, 100);
    expect(getContinueWatching(USER)).toEqual([]);
  });

  it("records real watching, most recently watched first", () => {
    saveWatchProgress(USER, "vid-1", 12, 100);
    vi.setSystemTime(BASE + 60_000);
    saveWatchProgress(USER, "vid-2", 30, 120);

    expect(getContinueWatching(USER).map((p) => p.videoId)).toEqual(["vid-2", "vid-1"]);
    expect(getWatchProgress(USER, "vid-1")?.progressSeconds).toBe(12);
  });

  it("drops a video once it is essentially finished", () => {
    saveWatchProgress(USER, "vid-1", 12, 100);
    saveWatchProgress(USER, "vid-1", 96, 100);
    expect(getWatchProgress(USER, "vid-1")).toBeUndefined();
  });

  it("clearing one video leaves the rest", () => {
    saveWatchProgress(USER, "vid-1", 12, 100);
    saveWatchProgress(USER, "vid-2", 30, 120);
    clearWatchProgress(USER, "vid-1");

    expect(getContinueWatching(USER).map((p) => p.videoId)).toEqual(["vid-2"]);
  });

  it("never records for a signed-out viewer", () => {
    saveWatchProgress(undefined, "vid-1", 12, 100);
    expect(getContinueWatching(undefined)).toEqual([]);
  });

  it("keeps only the fifty most recent videos", () => {
    for (let i = 0; i < 60; i++) {
      vi.setSystemTime(BASE + i * 1000);
      saveWatchProgress(USER, `vid-${i}`, 10, 100);
    }
    const kept = getContinueWatching(USER);
    expect(kept).toHaveLength(50);
    expect(kept[0]?.videoId).toBe("vid-59");
    expect(kept.some((p) => p.videoId === "vid-0")).toBe(false);
  });

  it("keeps each account's history separate", () => {
    saveWatchProgress(USER, "vid-1", 12, 100);
    saveWatchProgress("user-2", "vid-9", 40, 100);

    expect(getContinueWatching(USER).map((p) => p.videoId)).toEqual(["vid-1"]);
    expect(getContinueWatching("user-2").map((p) => p.videoId)).toEqual(["vid-9"]);
  });

  it("survives corrupted storage", () => {
    window.localStorage.setItem("wizz:watch-progress:user-1", "{oops");
    expect(getContinueWatching(USER)).toEqual([]);

    saveWatchProgress(USER, "vid-1", 12, 100);
    expect(getWatchProgress(USER, "vid-1")).toBeDefined();
  });
});
