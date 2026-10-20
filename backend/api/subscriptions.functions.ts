import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * WIZZ Premium membership and verified-badge requests.
 *
 * Until a payment provider is configured (`VITE_PAYMENT_PROVIDER`), Premium
 * activates instantly as a preview membership — the state still lives in the
 * database so it follows the account across devices, and a checkout can slot
 * into `activatePremium` later without touching the read paths. Verified is
 * deliberately never self-grantable: users file a request here, admins
 * approve it from the console, and a trigger on `profiles` refuses client
 * updates to the privilege columns.
 */

export const PREMIUM_PERIOD_DAYS = 30;

export interface SubscriptionState {
  premiumUntil: string | null;
  premiumActive: boolean;
  verified: boolean;
  verificationStatus: "none" | "pending" | "verified";
  /** False when the schema is missing so the UI can fall back to local state. */
  live: boolean;
}

export const OFFLINE_SUBSCRIPTION: SubscriptionState = {
  premiumUntil: null,
  premiumActive: false,
  verified: false,
  verificationStatus: "none",
  live: false,
};

/** Pure membership derivation — expiry is evaluated against an injected clock. */
export function premiumActiveAt(premiumUntil: string | null | undefined, now: Date): boolean {
  if (!premiumUntil) return false;
  const expires = Date.parse(premiumUntil);
  return Number.isFinite(expires) && expires > now.getTime();
}

/** Pure verification status: an already-verified account outranks a queue row. */
export function deriveVerificationStatus(
  verified: boolean,
  hasPendingRequest: boolean,
): SubscriptionState["verificationStatus"] {
  if (verified) return "verified";
  return hasPendingRequest ? "pending" : "none";
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

/** Reads the caller's membership + queue state. Never throws. */
async function loadSubscriptionState(userId: string): Promise<SubscriptionState> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date();
    const [{ data: profile, error }, { data: request, error: requestError }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("verified, premium_until")
        .eq("id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("verification_requests")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "pending")
        .maybeSingle(),
    ]);
    if (error || requestError) return OFFLINE_SUBSCRIPTION;
    const premiumUntil = (profile?.premium_until as string | null) ?? null;
    return {
      premiumUntil,
      premiumActive: premiumActiveAt(premiumUntil, now),
      verified: Boolean(profile?.verified),
      verificationStatus: deriveVerificationStatus(Boolean(profile?.verified), Boolean(request)),
      live: true,
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
        .update({ premium_until: premiumUntil })
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
        .update({ premium_until: null })
        .eq("id", userId);
      if (error) throw error;
    } catch {
      // Fall through to the state read — offline reporting is enough.
    }
    return loadSubscriptionState(userId);
  });

export const requestVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { note?: string } | undefined) => ({
    // Non-string notes (defensive payloads) coerce to empty, never crash.
    note: (typeof data?.note === "string" ? data.note : "").slice(0, 300),
  }))
  .handler(async ({ context, data }): Promise<SubscriptionState> => {
    const userId = (context as unknown as { userId: string }).userId;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("verified")
        .eq("id", userId)
        .maybeSingle();
      if (!profile?.verified) {
        // One live request per user (partial unique index): clear any stale
        // pending row first — PostgREST cannot infer partial indexes in
        // upserts — then file a fresh request.
        await supabaseAdmin
          .from("verification_requests")
          .delete()
          .eq("user_id", userId)
          .eq("status", "pending");
        const { error } = await supabaseAdmin
          .from("verification_requests")
          .insert({ user_id: userId, status: "pending", reviewer_note: data.note || null });
        if (error) throw error;
      }
    } catch {
      // Missing table → state read reports offline.
    }
    return loadSubscriptionState(userId);
  });
