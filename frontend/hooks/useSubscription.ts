import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  activatePremium,
  cancelPremium,
  fetchMySubscription,
  OFFLINE_SUBSCRIPTION,
  type SubscriptionState,
} from "@/backend/api/subscriptions.functions";
import { startPremiumSubscription } from "@/backend/api/billing.functions";
import { invalidateHomeCache } from "@/backend/api/home.functions";

/**
 * The signed-in account's Premium state — which is also its verified-badge
 * state, since the badge is a subscriber-only perk. When the backend schema
 * is missing the query resolves to OFFLINE_SUBSCRIPTION (`live: false`) so
 * the settings screens can fall back to their local-only toggles instead of
 * going blank.
 *
 * `opts.poll` drives a short refresh interval while a Stripe checkout sits
 * open in the browser: the webhook (or the return-page confirm) flips the
 * state server-side, and this is how the badge lands in the app.
 */
export function useSubscription(userId: string | null, opts?: { poll?: boolean }) {
  return useQuery({
    queryKey: ["subscription", userId],
    enabled: Boolean(userId),
    staleTime: 30_000,
    refetchInterval: opts?.poll ? 5_000 : false,
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
  // Single entry point for every Subscribe button: preview mode activates
  // immediately, Stripe mode returns a hosted-checkout URL to open.
  const startCheckout = useMutation({
    mutationFn: () => startPremiumSubscription(),
    onSuccess: invalidate,
  });

  return { activate, cancel, startCheckout };
}

/**
 * Tracks a checkout that is open in the browser: `awaiting` turns on when
 * the caller opens the URL (and starts the 5s subscription poll), turns off
 * the moment the membership becomes active — `onConfirmed` fires exactly
 * then — or after two minutes, in case the tab was abandoned.
 */
export function useCheckoutAwait(userId: string | null, onConfirmed?: () => void) {
  const [awaiting, setAwaiting] = useState(false);
  const confirmedRef = useRef(onConfirmed);
  confirmedRef.current = onConfirmed;
  const { data } = useSubscription(userId, { poll: awaiting });

  useEffect(() => {
    if (!awaiting) return;
    if (data?.premiumActive) {
      setAwaiting(false);
      confirmedRef.current?.();
      return;
    }
    const timer = setTimeout(() => setAwaiting(false), 120_000);
    return () => clearTimeout(timer);
  }, [awaiting, data?.premiumActive]);

  return { awaiting, setAwaiting };
}
