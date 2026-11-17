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

export async function registerMediaServiceWorker(): Promise<void> {
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
}

export async function clearMediaCache(): Promise<void> {
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
        names
          .filter((name) => name.startsWith("wizz-media-"))
          .map((name) => caches.delete(name)),
      );
    } catch {
      // non-fatal
    }
  }
}

const MEDIA_URL_PATTERN =
  /\.(?:jpe?g|png|gif|webp|avif|heic|heif|bmp|svg)(?:\?|$)|(?:\/storage\/v1\/object\/)/i;

/** Walk cached query data and collect image/media URLs to warm on app open. */
export function collectMediaUrls(value: unknown, output: string[] = [], depth = 0): string[] {
  if (depth > 7 || output.length >= 120) return output;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && MEDIA_URL_PATTERN.test(value) && !output.includes(value)) {
      output.push(value);
    }
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMediaUrls(item, output, depth + 1);
    return output;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectMediaUrls(item, output, depth + 1);
  }
  return output;
}

/**
 * Images load through the service worker when created, so a plain `new Image()`
 * is enough to download signed media into the persistent Cache Storage while
 * the user still has a connection.
 */
export function warmMediaUrls(urls: string[]): void {
  if (typeof window === "undefined") return;
  for (const url of urls.slice(0, 80)) {
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
    } catch {
      // Ignore invalid/unreachable media; offline UI degrades to text previews.
    }
  }
}

export function warmMediaFromCache(queryClient: QueryClient): void {
  const urls: string[] = [];
  for (const query of queryClient.getQueryCache().getAll()) {
    collectMediaUrls(query.state.data, urls);
    if (urls.length >= 120) break;
  }
  warmMediaUrls(urls);
}
