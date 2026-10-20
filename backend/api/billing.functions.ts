import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createStripeApi,
  ensurePremiumPrice,
  isUuid,
  siteBaseUrl,
  stripeIsConfigured,
  stripeSecretKey,
  subscriptionIsActive,
  subscriptionPeriodEndISO,
} from "@/backend/api/stripe.helpers";
import { grantPreviewPremium, premiumActiveAt } from "@/backend/api/subscriptions.functions";

/**
 * Stripe Checkout for WIZZ Premium.
 *
 * The server is the only place that decides billing mode: with no
 * `STRIPE_SECRET_KEY` configured, `startPremiumSubscription` keeps today's
 * labelled free-preview activation, so the app behaves exactly as before
 * until keys are pasted in. With keys, it hands back a hosted-checkout URL —
 * the WebView never touches card fields, and the period is only ever granted
 * by Stripe-signed webhooks or by `confirmPremiumCheckout` reading the
 * session back from Stripe.
 */

export interface PremiumCheckoutStart {
  /** Hosted Stripe checkout URL, or null when nothing must be bought. */
  checkoutUrl: string | null;
  /** "preview" activates immediately; "stripe" waits for payment. */
  mode: "preview" | "stripe";
}

/**
 * One entry point for every Subscribe button.
 *
 * Preview mode: grant the 30-day preview + badge (the historical behaviour).
 * Stripe mode:
 *   1. an existing subscription is resumed (un-cancelled) — the API answer
 *      is authoritative, so this also heals accounts whose first checkout
 *      completed before the webhook was wired;
 *   2. an already-active period buys nothing (race protection);
 *   3. otherwise: reuse/create the Stripe customer, resolve the price
 *      (explicit id → lookup key → created on first use), open Checkout.
 * Any Stripe failure throws so the UI can toast instead of pretending.
 */
export const startPremiumSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PremiumCheckoutStart> => {
    const userId = (context as unknown as { userId: string }).userId;
    const email = (context as unknown as { claims?: { email?: string } }).claims?.email ?? null;
    const secretKey = stripeSecretKey();

    if (!stripeIsConfigured(secretKey)) {
      await grantPreviewPremium(userId);
      return { checkoutUrl: null, mode: "preview" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const api = createStripeApi(secretKey!, fetch);
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select(
        "premium_until, stripe_customer_id, stripe_subscription_id, premium_cancel_at_period_end",
      )
      .eq("id", userId)
      .maybeSingle();

    // 1. Existing subscription → resume it rather than check out a duplicate.
    const storedSubId = (profile?.stripe_subscription_id as string | null) ?? null;
    if (storedSubId) {
      try {
        const sub = await api.request<Record<string, unknown>>(
          "POST",
          `/subscriptions/${storedSubId}`,
          {
            cancel_at_period_end: "false",
          },
        );
        if (subscriptionIsActive(sub["status"])) {
          const premiumUntil = subscriptionPeriodEndISO(sub);
          const { error } = await supabaseAdmin
            .from("profiles")
            .update({
              ...(premiumUntil ? { premium_until: premiumUntil, verified: true } : {}),
              premium_cancel_at_period_end: sub["cancel_at_period_end"] === true,
              ...(typeof sub["id"] === "string" ? { stripe_subscription_id: sub["id"] } : {}),
              ...(typeof sub["customer"] === "string"
                ? { stripe_customer_id: sub["customer"] }
                : {}),
            })
            .eq("id", userId);
          if (error) throw error;
        }
        return { checkoutUrl: null, mode: "stripe" };
      } catch {
        // Ended at Stripe but never cleaned up locally — drop the stale
        // reference and fall through to a fresh checkout.
        await supabaseAdmin
          .from("profiles")
          .update({ stripe_subscription_id: null, premium_cancel_at_period_end: false })
          .eq("id", userId);
      }
    }

    // 2. Already covered → nothing to buy (a re-tap, or a preview-era period
    //    that is still running after the keys went in).
    const now = new Date();
    if (premiumActiveAt((profile?.premium_until as string | null) ?? null, now)) {
      return { checkoutUrl: null, mode: "stripe" };
    }

    // 3. Customer: reuse the stored id, else create one linked to the account.
    let customerId = (profile?.stripe_customer_id as string | null) ?? null;
    if (!customerId) {
      const customer = await api.request<{ id: string }>("POST", "/customers", {
        ...(email ? { email } : {}),
        metadata: { user_id: userId },
      });
      customerId = customer.id;
      const { error } = await supabaseAdmin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", userId);
      if (error) throw error;
    }

    // 4. Price, then the hosted checkout itself.
    const priceId = await ensurePremiumPrice(api);
    const base = siteBaseUrl();
    const session = await api.request<{ url: string | null }>("POST", "/checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: userId,
      metadata: { user_id: userId, product: "wizz_premium" },
      subscription_data: { metadata: { user_id: userId, product: "wizz_premium" } },
      success_url: `${base}/checkout?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/checkout?cancelled=1`,
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return { checkoutUrl: session.url, mode: "stripe" };
  });

/**
 * Confirms a completed checkout by reading the session back from Stripe —
 * deliberately unauthenticated: it runs on the return page in the browser,
 * where there is no app session, and it can only ever grant the account that
 * Stripe recorded as `client_reference_id` when *we* created the session,
 * and only when Stripe reports it paid. This is what makes the badge land
 * instantly even before a webhook is configured; renewals and cancellations
 * still need the webhook.
 */
export const confirmPremiumCheckout = createServerFn({ method: "POST" })
  .validator((data: { sessionId?: string } | undefined) => ({
    sessionId: typeof data?.sessionId === "string" ? data.sessionId : "",
  }))
  .handler(
    async ({ data }): Promise<{ ok: boolean; premiumUntil: string | null; reason?: string }> => {
      const { sessionId } = data;
      if (!/^cs_[A-Za-z0-9_]{6,128}$/.test(sessionId)) {
        return { ok: false, premiumUntil: null, reason: "bad_session" };
      }
      const secretKey = stripeSecretKey();
      if (!stripeIsConfigured(secretKey)) {
        return { ok: false, premiumUntil: null, reason: "not_configured" };
      }
      try {
        const api = createStripeApi(secretKey!, fetch);
        const session = await api.request<Record<string, unknown>>(
          "GET",
          `/checkout/sessions/${sessionId}`,
          { "expand[0]": "subscription" },
        );
        const metadata = session["metadata"] as Record<string, unknown> | undefined;
        if (session["mode"] !== "subscription" || metadata?.["product"] !== "wizz_premium") {
          return { ok: false, premiumUntil: null, reason: "not_wizz" };
        }
        const userId = session["client_reference_id"];
        if (!isUuid(userId)) return { ok: false, premiumUntil: null, reason: "no_user" };
        const payment = session["payment_status"];
        if (
          session["status"] !== "complete" ||
          (payment !== "paid" && payment !== "no_payment_required")
        ) {
          return { ok: false, premiumUntil: null, reason: "pending" };
        }
        const subscription = session["subscription"];
        if (!subscription || typeof subscription !== "object") {
          return { ok: false, premiumUntil: null, reason: "pending" };
        }
        const sub = subscription as Record<string, unknown>;
        if (!subscriptionIsActive(sub["status"])) {
          return { ok: false, premiumUntil: null, reason: "pending" };
        }
        const premiumUntil = subscriptionPeriodEndISO(sub);
        if (!premiumUntil) return { ok: false, premiumUntil: null, reason: "pending" };
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("profiles")
          .update({
            premium_until: premiumUntil,
            verified: true,
            premium_cancel_at_period_end: sub["cancel_at_period_end"] === true,
            ...(typeof sub["id"] === "string" ? { stripe_subscription_id: sub["id"] } : {}),
            ...(typeof session["customer"] === "string"
              ? { stripe_customer_id: session["customer"] }
              : {}),
          })
          .eq("id", userId);
        if (error) throw error;
        return { ok: true, premiumUntil };
      } catch {
        // Never break the return page — the message says it settles shortly.
        return { ok: false, premiumUntil: null, reason: "error" };
      }
    },
  );
