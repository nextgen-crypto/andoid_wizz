import type { FeedItem } from "@/backend/services/feedService";

/**
 * Small durable copy of the home feed pages the app has already downloaded.
 *
 * TanStack Query persists individual query results, but the home screen keeps
 * its paginated feed in local state. This snapshot lets a cold offline launch
 * paint several pages immediately, then the live query replaces it when the
 * network returns. Media bytes themselves live in the service-worker cache.
 */

const KEY_PREFIX = "wizz-feed-snapshot-v2";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_VIEWER = "public";
/** Enough for several scrolls without writing a huge IndexedDB value on every page. */
const MAX_SNAPSHOT_ITEMS = 60;

export interface FeedSnapshot {
  viewerId: string | null;
  mode: "all" | "following";
  items: FeedItem[];
  cursor: string | null;
  hasMore: boolean;
  savedAt: number;
}

function snapshotKey(viewerId: string | null, mode: "all" | "following"): string {
  return `${KEY_PREFIX}:${viewerId ?? PUBLIC_VIEWER}:${mode}`;
}

export async function saveFeedSnapshot(snapshot: Omit<FeedSnapshot, "savedAt">): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const { set } = await import("idb-keyval");
    await set(snapshotKey(snapshot.viewerId, snapshot.mode), {
      ...snapshot,
      items: snapshot.items.slice(0, MAX_SNAPSHOT_ITEMS),
      savedAt: Date.now(),
    } satisfies FeedSnapshot);
  } catch {
    // A full/private IndexedDB must never stop the feed from rendering.
  }
}

export async function loadFeedSnapshot(
  viewerId: string | null,
  mode: "all" | "following",
): Promise<FeedSnapshot | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const { get } = await import("idb-keyval");
    const exact = await get<FeedSnapshot>(snapshotKey(viewerId, mode));
    if (exact && Date.now() - exact.savedAt < MAX_AGE) return exact;
    if (viewerId) {
      const publicFallback = await get<FeedSnapshot>(snapshotKey(null, mode));
      if (publicFallback && Date.now() - publicFallback.savedAt < MAX_AGE) {
        return publicFallback;
      }
    }
  } catch {
    // Ignore unreadable snapshots; the normal query path still runs.
  }
  return null;
}

export async function clearFeedSnapshots(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const { keys, del } = await import("idb-keyval");
    const all = await keys();
    await Promise.all(
      all
        .filter((key): key is string => typeof key === "string" && key.startsWith(KEY_PREFIX))
        .map((key) => del(key)),
    );
  } catch {
    // non-fatal
  }
}
