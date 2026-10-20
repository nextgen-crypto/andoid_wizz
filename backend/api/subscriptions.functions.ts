import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * WIZZ Premium membership — and the verified badge, which is a paid perk.
 *
 * Until a payment provider is configured (`VITE_PAYMENT_PROVIDER`), Premium
 * activates instantly as a preview membership — the state still lives in the
 * database so it follows the account across devices, and a checkout can slot
 * into `activatePremium` later without touching the read paths. The badge
 * belongs to subscribers only: activating grants it, cancelling (or letting
 * the period expire) takes it away, and nothing else can flip
 * `profiles.verified` — a trigger refuses every client-side update to the
 * privilege columns.
 */

export const PREMIUM_PERIOD_DAYS = 30;

export interface SubscriptionState {
  premiumUntil: string | null;
  premiumActive: boolean;
  /** `profiles.verified`, kept in step with `premiumActive` by the read path. */
  verified: boolean;
  /** False when the schema is missing so the UI can fall back to local state. */
  live: boolean;
}

export const OFFLINE_SUBSCRIPTION: SubscriptionState = {
  premiumUntil: null,
  premiumActive: false,
  verified: false,
  live: false,
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
      .select("verified, premium_until")
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
    return { premiumUntil, premiumActive, verified, live: true };
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

export const activatePremium = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SubscriptionState> => {
    const userId = (context as unknown as { userId: string }).userId;
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
    return loadSubscriptionState(userId);
  });

export const cancelPremium = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SubscriptionState> => {
    const userId = (context as unknown as { userId: string }).userId;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin
        .from("profiles")
        // No subscription, no badge — the paid-only rule, enforced on write.
        .update({ premium_until: null, verified: false })
        .eq("id", userId);
      if (error) throw error;
    } catch {
      // Fall through to the state read — offline reporting is enough.
    }
    return loadSubscriptionState(userId);
  });
