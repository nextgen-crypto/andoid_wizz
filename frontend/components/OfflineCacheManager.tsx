import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  onlineManager,
  useIsRestoring,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";

import { homeQueryOptions, loadFeedPage } from "@/frontend/queries/home";
import {
  newsQueryOptions,
  newsTopicsQueryOptions,
  profileQueryOptions,
  shortsQueryOptions,
  videosQueryOptions,
} from "@/frontend/queries/sections";
import { newsStoriesQueryOptions } from "@/frontend/hooks/useNewsStories";
import { trendingTopicsQueryOptions } from "@/frontend/hooks/useTrendingTopics";
import { myProfileQueryOptions } from "@/frontend/hooks/useMyProfile";
import { conversationsQueryOptions, messagesQueryOptions } from "@/frontend/hooks/useMessages";
import { notificationsQueryOptions } from "@/frontend/hooks/useNotifications";
import { useSession } from "@/frontend/hooks/useSession";
import {
  clearFeedSnapshots,
  loadFeedSnapshot,
  saveFeedSnapshot,
} from "@/frontend/lib/feedSnapshot";
import {
  clearMediaCache,
  clearPersistedQueryCache,
  registerMediaServiceWorker,
  warmMediaFromCache,
  warmMediaValue,
} from "@/frontend/lib/offlineStorage";

const OWNER_KEY = "wizz:cache-owner";
const HOME_PREFETCH_EXTRA_PAGES = 2;
const FEED_SNAPSHOT_FRESH_MS = 30 * 60 * 1000;

const PUBLIC_PREFETCHES = [
  homeQueryOptions,
  newsStoriesQueryOptions,
  trendingTopicsQueryOptions,
  shortsQueryOptions,
  videosQueryOptions,
  newsQueryOptions,
  newsTopicsQueryOptions,
  profileQueryOptions,
];

function useOnline(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => onlineManager.subscribe(onStoreChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/**
 * Download a few home-feed pages while the app is open so a later cold start
 * can scroll without a connection. HomeScreen saves its own richer snapshot as
 * the viewer pages, but this public snapshot is what makes a fresh install
 * useful before the first signed-in visit.
 */
async function prefetchHomeFeed(queryClient: QueryClient): Promise<void> {
  const existing = await loadFeedSnapshot(null, "all");
  if (existing && Date.now() - existing.savedAt < FEED_SNAPSHOT_FRESH_MS) {
    warmMediaValue(existing.items);
    return;
  }

  const first = await queryClient.ensureQueryData(homeQueryOptions);
  let items = first.feed.items;
  let cursor = first.feed.nextCursor;
  let hasMore = first.feed.hasMore;

  for (let page = 0; page < HOME_PREFETCH_EXTRA_PAGES && hasMore && cursor; page += 1) {
    const next = await loadFeedPage(cursor);
    const seen = new Set(items.map((item) => item.post.id));
    items = [...items, ...next.items.filter((item) => !seen.has(item.post.id))];
    cursor = next.nextCursor;
    hasMore = next.hasMore;
  }

  await saveFeedSnapshot({
    viewerId: null,
    mode: "all",
    items,
    cursor,
    hasMore,
  });
  warmMediaValue(items);
}

/**
 * Keeps WIZZ usable without a connection:
 * - restores the persisted query cache before screens subscribe
 * - prefetches public + signed-in data into that cache on app open/reconnect
 * - warms image bytes into the service-worker media cache
 * - clears private cached data when the signed-in account changes
 */
export function OfflineCacheManager() {
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();
  const { user, loading: sessionLoading } = useSession();
  const online = useOnline();
  const publicStarted = useRef(false);
  const userPrefetchedFor = useRef<string | null>(null);

  // Native WebView navigation state is not always reflected in navigator.onLine.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let listener: { remove: () => Promise<void> | void } | null = null;
    let disposed = false;

    void (async () => {
      try {
        const status = await Network.getStatus();
        if (!disposed) onlineManager.setOnline(status.connected);
      } catch {
        // Fall back to the browser's own online/offline events.
      }
      try {
        listener = await Network.addListener("networkStatusChange", (status) => {
          onlineManager.setOnline(status.connected);
        });
        if (disposed) await listener.remove();
      } catch {
        // Non-fatal: onlineManager still listens to window online/offline.
      }
    })();

    return () => {
      disposed = true;
      void listener?.remove();
    };
  }, []);

  // Register the media cache before warming any URLs.
  useEffect(() => {
    void registerMediaServiceWorker();
  }, []);

  // Drop cached private data if another account signs in or the user signs out.
  useEffect(() => {
    if (sessionLoading) return;
    try {
      const current = user?.id ?? "";
      const previous = localStorage.getItem(OWNER_KEY) ?? "";
      if (previous && previous !== current) {
        queryClient.clear();
        void clearPersistedQueryCache();
        void clearMediaCache();
        void clearFeedSnapshots();
      }
      localStorage.setItem(OWNER_KEY, current);
    } catch {
      // Private browsing modes may block localStorage; caching still works.
    }
  }, [user?.id, sessionLoading, queryClient]);

  // Immediately reuse whatever was downloaded on previous opens.
  useEffect(() => {
    if (isRestoring) return;
    warmMediaFromCache(queryClient);
  }, [isRestoring, queryClient]);

  // Public content: download once per app open (or on reconnect if launched offline).
  useEffect(() => {
    if (isRestoring || !online || publicStarted.current) return;
    publicStarted.current = true;
    void (async () => {
      // Sequential instead of a burst: loading every section at once spiked
      // WebView memory on Android before the first screen had even settled.
      for (const options of PUBLIC_PREFETCHES) {
        try {
          await queryClient.prefetchQuery(
            options as unknown as Parameters<typeof queryClient.prefetchQuery>[0],
          );
        } catch {
          // One failed section must not stop the rest from being cached.
        }
      }
      try {
        await prefetchHomeFeed(queryClient);
      } catch {
        // The first page is already cached; extra pages are best-effort.
      }
      warmMediaFromCache(queryClient);
    })();
  }, [isRestoring, online, queryClient]);

  // Signed-in content: conversations/messages, notifications and own profile.
  useEffect(() => {
    if (isRestoring || !online || !user?.id) return;
    const userId = user.id;
    if (userPrefetchedFor.current === userId) return;
    userPrefetchedFor.current = userId;

    void (async () => {
      await Promise.allSettled([
        queryClient.prefetchQuery(myProfileQueryOptions(userId)),
        queryClient.prefetchQuery(notificationsQueryOptions(userId)),
        (async () => {
          const conversations = await queryClient.fetchQuery(conversationsQueryOptions(userId));
          await Promise.allSettled(
            conversations
              .slice(0, 6)
              .map((conversation) =>
                queryClient.prefetchQuery(messagesQueryOptions(conversation.id, userId)),
              ),
          );
        })(),
      ]);
      warmMediaFromCache(queryClient);
    })();
  }, [isRestoring, online, user?.id, queryClient]);

  return null;
}
