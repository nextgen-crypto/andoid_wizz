import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Query, QueryClient } from "@tanstack/react-query";

/**
 * Offline-first storage for WIZZ.
 *
 * Query results are persisted to IndexedDB so a cold app start can render the
 * last known feed/messages before any network request resolves. Media bytes are
 * cached separately by the service worker in `public/sw.js`, keyed by canonical
 * storage path so short-lived signed URLs do not invalidate the cache.
 */

const PERSISTED_CACHE_KEY = "wizz-query-cache-v1";
const CACHE_BUSTER = "wizz-offline-v1";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

// Queries that are either server-admin-only or too transient/sensitive to keep
// on disk. Everything else (feed, stories, posts, profiles, DMs, notifications)
// is persisted so every main screen can render offline.
const BLOCKED_QUERY_PREFIXES = new Set([
  "admin",
  "cache-stats",
  "search",
  "search-users",
  "search-posts",
  "billing",
  "promotions",
]);

function shouldPersistQuery(query: Query): boolean {
  if (query.state.status !== "success") return false;
  const prefix = String(query.queryKey[0] ?? "");
  if (BLOCKED_QUERY_PREFIXES.has(prefix)) return false;
  if (prefix.toLowerCase().includes("search")) return false;
  return true;
}

function indexedDbStorage() {
  return {
    getItem: async (key: string): Promise<string | undefined> => {
      if (typeof indexedDB === "undefined") return undefined;
      const { get } = await import("idb-keyval");
      return get<string>(key);
    },
    setItem: async (key: string, value: string): Promise<void> => {
      if (typeof indexedDB === "undefined") return;
      const { set } = await import("idb-keyval");
      await set(key, value);
    },
    removeItem: async (key: string): Promise<void> => {
      if (typeof indexedDB === "undefined") return;
      const { del } = await import("idb-keyval");
      await del(key);
    },
  };
}

export const queryPersister = createAsyncStoragePersister({
  storage: indexedDbStorage(),
  key: PERSISTED_CACHE_KEY,
  throttleTime: 1000,
});

export const queryPersistenceOptions = {
  persister: queryPersister,
  maxAge: MAX_AGE,
  buster: CACHE_BUSTER,
  dehydrateOptions: {
    shouldDehydrateQuery: shouldPersistQuery,
  },
};

export async function clearPersistedQueryCache(): Promise<void> {
  await queryPersister.removeClient();
  if (typeof indexedDB === "undefined") return;
  const { del } = await import("idb-keyval");
  await del(PERSISTED_CACHE_KEY);
}

let mediaWorkerReady: Promise<void> | null = null;
/** URLs already requested this session, so screen changes don't re-download. */
const warmedUrls = new Set<string>();

export function registerMediaServiceWorker(): Promise<void> {
  if (mediaWorkerReady) return mediaWorkerReady;
  mediaWorkerReady = (async () => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // Dev servers should never serve stale cached assets; APK/web prod builds do.
    if (!import.meta.env.PROD) return;
    try {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch {
      // Service workers are an enhancement. Persisted JSON still works without one.
    }
  })();
  return mediaWorkerReady;
}

export async function clearMediaCache(): Promise<void> {
  warmedUrls.clear();
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      registration?.active?.postMessage({ type: "CLEAR_MEDIA_CACHE" });
    } catch {
      // non-fatal
    }
  }
  if (typeof caches !== "undefined") {
    try {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith("wizz-media-")).map((name) => caches.delete(name)),
      );
    } catch {
      // non-fatal
    }
  }
}

const IMAGE_URL_PATTERN = /\.(?:jpe?g|png|gif|webp|avif|heic|heif|bmp|svg)(?:\?|$)/i;
const VIDEO_URL_PATTERN = /\.(?:mp4|m4v|webm|mov|ogv|m3u8)(?:\?|$)/i;
const IMAGE_KEY_PATTERN = /(?:image|img|photo|thumb|poster|avatar|cover|preview)/i;
const VIDEO_KEY_PATTERN = /(?:video|clip|movie|audio)/i;
const MAX_COLLECT_URLS = 240;
const MAX_WARM_URLS = 60;
const WARM_CONCURRENCY = 3;

function isImageCandidate(url: string, key: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (VIDEO_URL_PATTERN.test(url)) return false;
  if (VIDEO_KEY_PATTERN.test(key)) return false;
  if (IMAGE_URL_PATTERN.test(url)) return true;
  // Supabase storage paths are often extensionless. Only trust them when the
  // field name itself says image/poster/avatar, never a generic `src`/`url`.
  return IMAGE_KEY_PATTERN.test(key);
}

/**
 * Walk cached query data and collect image URLs to warm on app open.
 *
 * This intentionally ignores video URLs and ambiguous `src`/`url` fields: a
 * previous version warmed everything under `/storage/v1/object/`, which could
 * download video bytes and decode them as images. That was enough to push the
 * Android WebView renderer over its memory limit and kill the app.
 */
export function collectMediaUrls(
  value: unknown,
  output: string[] = [],
  depth = 0,
  key = "",
): string[] {
  if (depth > 7 || output.length >= MAX_COLLECT_URLS) return output;
  if (typeof value === "string") {
    if (isImageCandidate(value, key) && !output.includes(value)) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMediaUrls(item, output, depth + 1, key);
    return output;
  }
  if (value && typeof value === "object") {
    const mediaType = (value as { mediaType?: unknown }).mediaType;
    for (const [childKey, item] of Object.entries(value)) {
      if (childKey === "mediaUrl" && mediaType === "video") continue;
      const nextKey = childKey === "mediaUrl" && mediaType === "image" ? "image" : childKey;
      collectMediaUrls(item, output, depth + 1, nextKey);
    }
  }
  return output;
}

/**
 * Download image bytes through the service worker without decoding them into
 * the renderer's image cache. Draining the body guarantees the response is
 * fully fetched while keeping memory flat even when warming many posters.
 */
export async function warmMediaUrls(urls: string[]): Promise<void> {
  if (typeof window === "undefined") return;
  const unique = [...new Set(urls)].filter((url) => !warmedUrls.has(url)).slice(0, MAX_WARM_URLS);
  if (unique.length === 0) return;
  await registerMediaServiceWorker();
  for (const url of unique) warmedUrls.add(url);

  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const url = unique[next++]!;
      try {
        const response = await fetch(url, {
          cache: "force-cache",
          credentials: "omit",
        });
        if (response.body) {
          // Discard chunks immediately; the service worker caches its own clone.
          const reader = response.body.getReader();
          try {
            while (!(await reader.read()).done) {
              // Drain without retaining image bytes in the renderer heap.
            }
          } finally {
            reader.releaseLock();
          }
        }
      } catch {
        // Ignore invalid/unreachable media; offline UI degrades to text previews.
      }
    }
  };
  await Promise.all(Array.from({ length: WARM_CONCURRENCY }, () => worker()));
}

export function warmMediaValue(value: unknown): void {
  const urls: string[] = [];
  collectMediaUrls(value, urls);
  void warmMediaUrls(urls);
}

export function warmMediaFromCache(queryClient: QueryClient): void {
  const urls: string[] = [];
  for (const query of queryClient.getQueryCache().getAll()) {
    collectMediaUrls(query.state.data, urls);
    if (urls.length >= MAX_COLLECT_URLS) break;
  }
  void warmMediaUrls(urls);
}
