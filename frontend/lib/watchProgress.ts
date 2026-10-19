/**
 * Real watch history for the Videos screen.
 *
 * "Continue watching" used to read `video.progressSeconds`, which was only
 * ever filled in by the seeded demo feed — so every fresh install showed
 * fake history. Progress is now recorded here while someone actually
 * watches, per user, and the rail renders solely from these entries:
 * no recording, no section.
 */

export type WatchProgress = {
  videoId: string;
  progressSeconds: number;
  totalSeconds: number;
  savedAt: number;
};

const KEY_PREFIX = "wizz:watch-progress:";
const MAX_ENTRIES = 50;
/** Below this a tap is a glance, not a watch. */
const MIN_PROGRESS_SECONDS = 5;
/** At this fraction the video counts as finished — it leaves the rail. */
const FINISHED_RATIO = 0.95;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function read(userId: string | undefined): Record<string, WatchProgress> {
  if (!userId || !canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${userId}`);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, WatchProgress>;
  } catch {
    // Corrupt or blocked storage — treat as "no history yet".
    return {};
  }
}

function write(userId: string, entries: Record<string, WatchProgress>): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(`${KEY_PREFIX}${userId}`, JSON.stringify(entries));
  } catch {
    // Quota or private mode — history is best-effort.
  }
}

export function getWatchProgress(
  userId: string | undefined,
  videoId: string,
): WatchProgress | undefined {
  return read(userId)[videoId];
}

/** Saved history, most recently watched first, capped at MAX_ENTRIES. */
export function getContinueWatching(userId: string | undefined): WatchProgress[] {
  return Object.values(read(userId))
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MAX_ENTRIES);
}

export function saveWatchProgress(
  userId: string | undefined,
  videoId: string,
  progressSeconds: number,
  totalSeconds: number,
): void {
  if (!userId) return;
  if (!Number.isFinite(progressSeconds) || progressSeconds < MIN_PROGRESS_SECONDS) return;
  if (totalSeconds > 0 && progressSeconds / totalSeconds >= FINISHED_RATIO) {
    clearWatchProgress(userId, videoId);
    return;
  }
  const entries = read(userId);
  entries[videoId] = { videoId, progressSeconds, totalSeconds, savedAt: Date.now() };
  const trimmed = Object.values(entries)
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MAX_ENTRIES);
  const next: Record<string, WatchProgress> = {};
  for (const entry of trimmed) next[entry.videoId] = entry;
  write(userId, next);
}

export function clearWatchProgress(userId: string | undefined, videoId: string): void {
  if (!userId) return;
  const entries = read(userId);
  if (!(videoId in entries)) return;
  delete entries[videoId];
  write(userId, entries);
}
