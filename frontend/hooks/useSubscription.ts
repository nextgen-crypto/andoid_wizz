import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  activatePremium,
  cancelPremium,
  fetchMySubscription,
  OFFLINE_SUBSCRIPTION,
  type SubscriptionState,
} from "@/backend/api/subscriptions.functions";
import { invalidateHomeCache } from "@/backend/api/home.functions";

/**
 * The signed-in account's Premium state — which is also its verified-badge
 * state, since the badge is a subscriber-only perk. When the backend schema
 * is missing the query resolves to OFFLINE_SUBSCRIPTION (`live: false`) so
 * the settings screens can fall back to their local-only toggles instead of
 * going blank.
 */
export function useSubscription(userId: string | null) {
  return useQuery({
    queryKey: ["subscription", userId],
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<SubscriptionState> => {
      try {
        return await fetchMySubscription();
      } catch {
        return OFFLINE_SUBSCRIPTION;
      }
    },
  });
}

/** Premium activation/cancellation — activating also grants the verified badge. */
export function useSubscriptionActions() {
  const queryClient = useQueryClient();
  const bustFeedCache = useServerFn(invalidateHomeCache);
  const invalidate = () => {
    // The badge renders from several caches — subscription row, profile
    // headers, feed author lines — so refresh them together.
    void queryClient.invalidateQueries({ queryKey: ["subscription"] });
    void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
    void queryClient.invalidateQueries({ queryKey: ["profile-by-username"] });
    void bustFeedCache().catch(() => undefined);
  };

  const activate = useMutation({
    mutationFn: () => activatePremium(),
    onSuccess: invalidate,
  });
  const cancel = useMutation({
    mutationFn: () => cancelPremium(),
    onSuccess: invalidate,
  });

  return { activate, cancel };
}
