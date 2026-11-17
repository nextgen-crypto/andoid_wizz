import { useEffect, useRef, useSyncExternalStore } from "react";
import { onlineManager, useIsRestoring, useQueryClient } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";

import { homeQueryOptions } from "@/frontend/queries/home";
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
import {
  conversationsQueryOptions,
  messagesQueryOptions,
} from "@/frontend/hooks/useMessages";
import { notificationsQueryOptions } from "@/frontend/hooks/useNotifications";
import { useSession } from "@/frontend/hooks/useSession";
import {
  clearMediaCache,
  clearPersistedQueryCache,
  registerMediaServiceWorker,
  warmMediaFromCache,
} from "@/frontend/lib/offlineStorage";

const OWNER_KEY = "wizz:cache-owner";

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

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-2 z-[10000] -translate-x-1/2 rounded-full bg-amber-400/95 px-3 py-1 text-[11px] font-semibold text-amber-950 shadow-lg">
      Offline — showing saved content
    </div>
  );
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
      await Promise.allSettled(
        PUBLIC_PREFETCHES.map((options) =>
          queryClient.prefetchQuery(
            options as unknown as Parameters<typeof queryClient.prefetchQuery>[0],
          ),
        ),
      );
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
          const conversations = await queryClient.fetchQuery(
            conversationsQueryOptions(userId),
          );
          await Promise.allSettled(
            conversations.slice(0, 6).map((conversation) =>
              queryClient.prefetchQuery(
                messagesQueryOptions(conversation.id, userId),
              ),
            ),
          );
        })(),
      ]);
      warmMediaFromCache(queryClient);
    })();
  }, [isRestoring, online, user?.id, queryClient]);

  return <OfflineBanner />;
}
