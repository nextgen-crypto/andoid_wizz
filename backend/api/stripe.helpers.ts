/**
 * Stripe REST plumbing — zero dependencies, raw `fetch` against
 * `https://api.stripe.com/v1`.
 *
 * Nothing here talks to Supabase or reads the request context; every helper
 * is pure or takes its I/O as a parameter, so the matrix tests can drive the
 * whole subscription flow (customer → price → checkout session → confirm)
 * with a scripted fetch recorder and no network.
 *
 * Two kinds of caller:
 *   - backend/api/billing.functions.ts — creates customers, checkout
 *     sessions and portal/confirm reads (server-only, secret key).
 *   - The `stripe-webhook` edge function ships its own self-contained copy
 *     of the event mapping (Deno deploys one file, no repo imports).
 *
 * Environment (all optional — without them WIZZ stays in the labelled
 * free-preview mode, which is the default behaviour today):
 *   STRIPE_SECRET_KEY       sk_live_…/sk_test_… — enables Checkout
 *   STRIPE_PRICE_ID         optional explicit Price (else auto-created
 *                           under the `wizz_premium_monthly` lookup key)
 *   STRIPE_PREMIUM_AMOUNT   minor units, default 499
 *   STRIPE_CURRENCY         default "usd"
 *   SITE_URL                return URLs, default https://wizz-kohl.vercel.app
 */

export type StripeFormValue = string | number | boolean | null | undefined;
export type StripeFormParams = {
  [key: string]: StripeFormValue | StripeFormParams | Array<StripeFormParams | StripeFormValue>;
};

/**
 * Flatten nested params into Stripe's bracket notation:
 *   { line_items: [{ price: "p_1" }] }  →  line_items[0][price]=p_1
 *   { lookup_keys: ["a"] }              →  lookup_keys[0]=a
 * Null/undefined values are dropped (an omitted key means "leave default").
 */
export function stripeFormEncode(params: StripeFormParams, prefix = ""): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        const indexed = `${name}[${index}]`;
        if (entry !== null && typeof entry === "object") {
          pairs.push(stripeFormEncode(entry as StripeFormParams, indexed));
        } else {
          pairs.push(`${indexed}=${encodeURIComponent(String(entry))}`);
        }
      });
    } else if (typeof value === "object") {
      pairs.push(stripeFormEncode(value as StripeFormParams, name));
    } else {
      pairs.push(`${name}=${encodeURIComponent(String(value))}`);
    }
  }
  return pairs.filter(Boolean).join("&");
}

/**
 * Live billing is a function of the secret key existing — the server decides,
 * never the client bundle, so a stray `VITE_*` flag cannot unlock checkout
 * (or worse, claim it is off while it is on).
 */
export function stripeIsConfigured(secretKey: string | null | undefined): boolean {
  return (
    typeof secretKey === "string" && (secretKey.startsWith("sk_") || secretKey.startsWith("rk_"))
  );
}

/** Reads the secret key from an env bag (defaults to the server environment). */
export function stripeSecretKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env["STRIPE_SECRET_KEY"];
}

/** Price settings with safe defaults — bad env values fall back, never throw. */
export function premiumPriceSettings(env: Record<string, string | undefined> = process.env): {
  unitAmount: number;
  currency: string;
} {
  const raw = Number.parseInt(env["STRIPE_PREMIUM_AMOUNT"] ?? "", 10);
  const unitAmount = Number.isFinite(raw) && raw > 0 ? raw : 499;
  const currency = (env["STRIPE_CURRENCY"] ?? "usd").toLowerCase();
  return { unitAmount, currency: /^[a-z]{3}$/.test(currency) ? currency : "usd" };
}

/** The checkout return URL — never empty, so Stripe always gets a valid one. */
export function siteBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = (env["SITE_URL"] ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(raw) ? raw : "https://wizz-kohl.vercel.app";
}

/**
 * ISO end of the paid period. Stripe moved the period fields onto the
 * subscription item in newer API versions — accept both shapes, because the
 * version is whatever the account's key defaults to.
 */
export function subscriptionPeriodEndISO(subscription: unknown): string | null {
  if (!subscription || typeof subscription !== "object") return null;
  const sub = subscription as Record<string, unknown>;
  const items = sub["items"] as { data?: unknown[] } | undefined;
  const firstItem = Array.isArray(items?.data) ? items.data[0] : null;
  const item = (firstItem ?? null) as Record<string, unknown> | null;
  const epoch =
    typeof sub["current_period_end"] === "number"
      ? sub["current_period_end"]
      : typeof item?.["current_period_end"] === "number"
        ? item["current_period_end"]
        : null;
  if (epoch === null || !Number.isFinite(epoch)) return null;
  return new Date(epoch * 1000).toISOString();
}

/** Statuses that grant access (trialing counts — Stripe already took the money). */
export function subscriptionIsActive(status: unknown): boolean {
  return status === "active" || status === "trialing";
}

/** Statuses where the subscription is over — access must stop. */
export function subscriptionHasEnded(status: unknown): boolean {
  return status === "canceled" || status === "incomplete_expired" || status === "unpaid";
}

export interface StripeApi {
  request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    params?: StripeFormParams,
  ): Promise<T>;
}

/**
 * Minimal Stripe REST client. Non-2xx becomes a thrown Error carrying
 * Stripe's own message so the caller (or a toast) can surface it.
 */
export function createStripeApi(secretKey: string, fetchFn: typeof fetch = fetch): StripeApi {
  return {
    async request<T>(
      method: "GET" | "POST" | "DELETE",
      path: string,
      params?: StripeFormParams,
    ): Promise<T> {
      const encoded = params ? stripeFormEncode(params) : "";
      const query = method === "GET" && encoded ? `?${encoded}` : "";
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          ...(method !== "GET" && encoded
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        ...(method !== "GET" && encoded ? { body: encoded } : {}),
      };
      const response = await fetchFn(`https://api.stripe.com/v1${path}${query}`, init);
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? `Stripe request failed (${response.status})`);
      }
      return payload as T;
    },
  };
}

// The recurring price is discovered by lookup key and then cached per warm
// server instance — a cold start re-checks, so a dashboard edit is picked up
// without a deploy.
let cachedPriceId: string | null = null;

export function clearStripePriceCache(): void {
  cachedPriceId = null;
}

/**
 * Resolve the WIZZ Premium price: an explicit `STRIPE_PRICE_ID` wins,
 * otherwise the `wizz_premium_monthly` lookup key, otherwise the product and
 * price are created on first checkout — so pasting a secret key is the only
 * setup the account needs.
 */
export async function ensurePremiumPrice(
  api: StripeApi,
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const explicit = env["STRIPE_PRICE_ID"];
  if (explicit) return explicit;
  if (cachedPriceId) return cachedPriceId;
  const found = await api.request<{ data?: Array<{ id?: string }> }>("GET", "/prices", {
    "lookup_keys[0]": "wizz_premium_monthly",
    active: "true",
  });
  const existing = found.data?.[0]?.id;
  if (existing) {
    cachedPriceId = existing;
    return cachedPriceId;
  }
  const { unitAmount, currency } = premiumPriceSettings(env);
  const product = await api.request<{ id: string }>("POST", "/products", {
    name: "WIZZ Premium",
    metadata: { product: "wizz_premium" },
  });
  const price = await api.request<{ id: string }>("POST", "/prices", {
    product: product.id,
    unit_amount: unitAmount,
    currency,
    "recurring[interval]": "month",
    "lookup_keys[0]": "wizz_premium_monthly",
  });
  cachedPriceId = price.id;
  return cachedPriceId;
}

/** Supabase auth user ids are UUIDs — gate writes on that shape. */
export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
