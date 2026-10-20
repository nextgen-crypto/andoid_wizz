import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createStripeApi, stripeIsConfigured, stripeSecretKey } from "@/backend/api/stripe.helpers";

/**
 * WIZZ Premium membership — and the verified badge, which is a paid perk.
 *
 * Two billing modes, chosen server-side by the presence of
 * `STRIPE_SECRET_KEY` (`SubscriptionState.billing` reports it):
 *
 *   "preview"  Premium activates instantly as a labelled free preview — the
 *              state still lives in the database so it follows the account
 *              across devices. This is the default until Stripe keys exist.
 *   "stripe"   Real subscriptions: `startPremiumSubscription` opens Stripe
 *              Checkout, and only Stripe-signed webhooks (or the checkout
 *              confirmation) write the period. Cancelling stops the renewal
 *              and runs the already-paid period to its end.
 *
 * Either way the badge belongs to subscribers only: activating grants it,
 * cancelling (or letting the period expire) takes it away, and nothing else
 * can flip `profiles.verified` — a trigger refuses every client-side update
 * to the privilege columns, stripe ids included.
 */

export const PREMIUM_PERIOD_DAYS = 30;

export type BillingMode = "preview" | "stripe";

export interface SubscriptionState {
  premiumUntil: string | null;
  premiumActive: boolean;
  /** `profiles.verified`, kept in step with `premiumActive` by the read path. */
  verified: boolean;
  /** False when the schema is missing so the UI can fall back to local state. */
  live: boolean;
  /** "stripe" once a secret key is configured — checkout is live. */
  billing: BillingMode;
  /** Cancelled at Stripe: access (and the badge) runs to `premiumUntil`. */
  cancelAtPeriodEnd: boolean;
}

export const OFFLINE_SUBSCRIPTION: SubscriptionState = {
  premiumUntil: null,
  premiumActive: false,
  verified: false,
  live: false,
  billing: "preview",
  cancelAtPeriodEnd: false,
};

/** Pure membership derivation — expiry is evaluated against an injected clock. */
export function premiumActiveAt(premiumUntil: string | null | undefined, now: Date): boolean {
  if (!premiumUntil) return false;
  const expires = Date.parse(premiumUntil);
  return Number.isFinite(expires) && expires > now.getTime();
}

/** Pure expiry arithmetic for a renewal/activation. */
export function nextPremiumUntil(
  current: string | null | undefined,
  now: Date,
  days = PREMIUM_PERIOD_DAYS,
): string {
  const currentMs = current ? Date.parse(current) : NaN;
  const base = Number.isFinite(currentMs) && currentMs > now.getTime() ? currentMs : now.getTime();
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Reads the caller's membership state and reconciles the badge with it.
 * Never throws. The write only happens when `verified !== premiumActive` —
 * it self-heals both directions of the paid-only rule: an activation that
 * landed on another device, and a period that expired without anybody
 * cancelling it.
 */
async function loadSubscriptionState(userId: string): Promise<SubscriptionState> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date();
    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("verified, premium_until, premium_cancel_at_period_end")
      .eq("id", userId)
      .maybeSingle();
    if (error) return OFFLINE_SUBSCRIPTION;
    const premiumUntil = (profile?.premium_until as string | null) ?? null;
    const premiumActive = premiumActiveAt(premiumUntil, now);
    let verified = Boolean(profile?.verified);
    if (profile && verified !== premiumActive) {
      const { error: writeError } = await supabaseAdmin
        .from("profiles")
        .update({ verified: premiumActive })
        .eq("id", userId);
      if (!writeError) verified = premiumActive;
    }
    return {
      premiumUntil,
      premiumActive,
      verified,
      live: true,
      billing: stripeIsConfigured(stripeSecretKey()) ? "stripe" : "preview",
      cancelAtPeriodEnd: profile?.premium_cancel_at_period_end === true,
    };
  } catch {
    return OFFLINE_SUBSCRIPTION;
  }
}

export const fetchMySubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SubscriptionState> => {
    const userId = (context as unknown as { userId: string }).userId;
    return loadSubscriptionState(userId);
  });

/**
 * Free-preview activation: a 30-day period plus the verified badge in one
 * service-role write. Only reachable while Stripe is unconfigured — see the
 * guard in `activatePremium`.
 */
export async function grantPreviewPremium(userId: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date();
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("premium_until")
      .eq("id", userId)
      .maybeSingle();
    const premiumUntil = nextPremiumUntil((profile?.premium_until as string | null) ?? null, now);
    const { error } = await supabaseAdmin
      .from("profiles")
      // The verified badge is the subscriber's perk — grant it with the period.
      .update({ premium_until: premiumUntil, verified: true })
      .eq("id", userId);
    if (error) throw error;
  } catch {
    // Schema missing → report offline rather than pretending to subscribe.
  }
}

export const activatePremium = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SubscriptionState> => {
    const userId = (context as unknown as { userId: string }).userId;
    // Live billing: self-granting would bypass Checkout. The subscribe button
    // uses startPremiumSubscription; this path stays for the preview mode.
    if (stripeIsConfigured(stripeSecretKey())) return loadSubscriptionState(userId);
    await grantPreviewPremium(userId);
    return loadSubscriptionState(userId);
  });

export const cancelPremium = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SubscriptionState> => {
    const userId = (context as unknown as { userId: string }).userId;
    let subscriptionId: string | null = null;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_subscription_id")
        .eq("id", userId)
        .maybeSingle();
      subscriptionId = (profile?.stripe_subscription_id as string | null) ?? null;
    } catch {
      // Schema missing → treat as preview mode below.
    }

    const secretKey = stripeSecretKey();
    if (subscriptionId && stripeIsConfigured(secretKey)) {
      // Stripe-managed: stop the renewal, but keep access (and the badge)
      // until the period the subscriber already paid for runs out. A failed
      // API call throws instead of silently keeping them billed — the client
      // surfaces it as a toast.
      const api = createStripeApi(secretKey!, fetch);
      await api.request("POST", `/subscriptions/${subscriptionId}`, {
        cancel_at_period_end: "true",
      });
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin
          .from("profiles")
          .update({ premium_cancel_at_period_end: true })
          .eq("id", userId);
      } catch {
        // Cosmetic flag — the webhook corrects it if this write is lost.
      }
      return loadSubscriptionState(userId);
    }

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin
        .from("profiles")
        // No subscription, no badge — the paid-only rule, enforced on write.
        .update({ premium_until: null, verified: false, premium_cancel_at_period_end: false })
        .eq("id", userId);
      if (error) throw error;
    } catch {
      // Fall through to the state read — offline reporting is enough.
    }
    return loadSubscriptionState(userId);
  });
