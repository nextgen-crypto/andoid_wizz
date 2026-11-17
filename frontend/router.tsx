import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { installNativeRpcBridge } from "@/frontend/lib/native";

export const getRouter = () => {
  // Route loaders call server functions, so the native bridge has to exist
  // before the first navigation — not after React mounts.
  installNativeRpcBridge();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Cached data stays usable across navigation + tab switches instead
        // of refetching on every window focus (biggest perceived-speed win).
        staleTime: 30_000,
        // Matches the persisted cache lifetime so rehydrated data is not
        // garbage-collected immediately after a cold start.
        gcTime: 7 * 24 * 60 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 1,
        // Render cached data first, then sync in the background. Requests are
        // paused while offline instead of turning cached screens into errors.
        networkMode: "offlineFirst",
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
