import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activatePremium,
  cancelPremium,
  fetchMySubscription,
  OFFLINE_SUBSCRIPTION,
  requestVerification,
  type SubscriptionState,
} from "@/backend/api/subscriptions.functions";

/**
 * The signed-in account's Premium + verification state, straight from the
 * database. When the backend schema is missing the query resolves to
 * OFFLINE_SUBSCRIPTION (`live: false`) so the settings screens can fall back
 * to their local-only toggles instead of going blank.
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

/** Premium activation/cancellation and the verified-badge request flow. */
export function useSubscriptionActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["subscription"] });

  const activate = useMutation({
    mutationFn: () => activatePremium(),
    onSuccess: invalidate,
  });
  const cancel = useMutation({
    mutationFn: () => cancelPremium(),
    onSuccess: invalidate,
  });
  const request = useMutation({
    mutationFn: (note?: string) => requestVerification({ data: { note: note ?? "" } }),
    onSuccess: invalidate,
  });

  return { activate, cancel, request };
}
