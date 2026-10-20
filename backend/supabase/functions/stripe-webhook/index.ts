/**
 * Stripe → WIZZ webhook (Supabase Edge Function, `verify_jwt: false`).
 *
 * Auth is the Stripe signature: HMAC-SHA256 over `${t}.${rawBody}` with the
 * endpoint's signing secret, checked against the `v1=` values in the
 * `stripe-signature` header (5-minute tolerance). Nothing else is trusted —
 * the function is publicly reachable at
 * https://<project>.supabase.co/functions/v1/stripe-webhook
 *
 * This file is deployed standalone (one file, no repo imports), so it stays
 * dependency-free: Web Crypto for the HMAC, plain `fetch` for PostgREST.
 * Every step before I/O is exported pure and pinned by the matrix tests in
 * this folder.
 *
 * Requires function secrets:
 *   STRIPE_WEBHOOK_SECRET   whsec_… (from the Stripe endpoint)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   — injected automatically
 *
 * Event → profiles mapping (all writes idempotent — Stripe may retry):
 *   checkout.session.completed    store customer/subscription ids (grant comes
 *                                from subscription.* or the return-page confirm)
 *   customer.subscription.*      active/trialing → period end + badge on;
 *                                canceled/unpaid → badge and period off;
 *                                past_due etc. → ids only (dunning keeps access)
 *   customer.subscription.deleted revoke: period, badge, cancel flag cleared
 *   anything else                acknowledged, ignored
 */

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

export function parseStripeSignature(header: string | null | undefined): {
  timestamp: number;
  signatures: string[];
} | null {
  if (!header) return null;
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) timestamp = parsed;
    } else if (key === "v1" && value) {
      signatures.push(value);
    }
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** Length-mixed compare so a partial match cannot short-circuit. */
function hexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function stripeSignatureValid(
  payload: string,
  header: string | null | undefined,
  secret: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!secret) return false;
  const parsed = parseStripeSignature(header);
  if (!parsed) return false;
  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${parsed.timestamp}.${payload}`),
      ),
    );
    const expected = toHex(mac);
    return parsed.signatures.some((candidate) => hexEquals(expected, candidate));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Event → profile patch
// ---------------------------------------------------------------------------

export interface WebhookPatch {
  /** From metadata/client_reference_id when we stamped one. */
  userId: string | null;
  /** Resolves profiles.stripe_customer_id when userId is absent. */
  customerId: string | null;
  /** Columns to write on the profile (never empty when patch is non-null). */
  profile: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EventLike = { type?: string; data?: { object?: Record<string, unknown> } } | null;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function periodEndISO(sub: Record<string, unknown>): string | null {
  const items = sub["items"] as { data?: unknown[] } | undefined;
  const first = Array.isArray(items?.data) ? items.data[0] : null;
  const item = (first ?? null) as Record<string, unknown> | null;
  const epoch =
    typeof sub["current_period_end"] === "number"
      ? sub["current_period_end"]
      : typeof item?.["current_period_end"] === "number"
        ? item["current_period_end"]
        : null;
  if (epoch === null || !Number.isFinite(epoch)) return null;
  return new Date(epoch * 1000).toISOString();
}

function metadataUser(obj: Record<string, unknown>): string | null {
  const meta = obj["metadata"] as Record<string, unknown> | undefined;
  const id = asString(meta?.["user_id"]) ?? asString(meta?.["userId"]);
  return id && UUID.test(id) ? id : null;
}

function clientReferenceUser(obj: Record<string, unknown>): string | null {
  const id = asString(obj["client_reference_id"]);
  return id && UUID.test(id) ? id : null;
}

/** Map one Stripe event to the profile write it implies — pure, no I/O. */
export function stripeEventPatch(event: EventLike): WebhookPatch | null {
  const type = event?.type;
  const obj = event?.data?.object;
  if (!type || !obj) return null;
  const userId =
    metadataUser(obj) ?? (type === "checkout.session.completed" ? clientReferenceUser(obj) : null);
  const customerId = asString(obj["customer"]);

  if (type === "checkout.session.completed") {
    const subscriptionId = asString(obj["subscription"]);
    const profile: Record<string, unknown> = {};
    if (customerId) profile["stripe_customer_id"] = customerId;
    if (subscriptionId) profile["stripe_subscription_id"] = subscriptionId;
    if (Object.keys(profile).length === 0) return null;
    return { userId, customerId, profile };
  }

  if (type === "customer.subscription.deleted") {
    return {
      userId,
      customerId,
      profile: {
        stripe_subscription_id: null,
        premium_until: null,
        verified: false,
        premium_cancel_at_period_end: false,
      },
    };
  }

  if (type === "customer.subscription.created" || type === "customer.subscription.updated") {
    const status = obj["status"];
    const profile: Record<string, unknown> = {
      premium_cancel_at_period_end: obj["cancel_at_period_end"] === true,
    };
    const subscriptionId = asString(obj["id"]);
    if (subscriptionId) profile["stripe_subscription_id"] = subscriptionId;
    if (customerId) profile["stripe_customer_id"] = customerId;
    if (status === "active" || status === "trialing") {
      const until = periodEndISO(obj);
      // The period is the source of truth; without it leave the badge alone.
      if (until) {
        profile["premium_until"] = until;
        profile["verified"] = true;
      }
    } else if (status === "canceled" || status === "incomplete_expired" || status === "unpaid") {
      profile["premium_until"] = null;
      profile["verified"] = false;
      profile["premium_cancel_at_period_end"] = false;
    }
    // past_due / incomplete / paused: dunning in progress — keep access; the
    // eventual `deleted` event revokes it.
    return { userId, customerId, profile };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface WebhookDeps {
  webhookSecret: string | null;
  findUserByCustomer(customerId: string): Promise<string | null>;
  applyProfilePatch(userId: string, profile: Record<string, unknown>): Promise<void>;
  nowSeconds?: () => number;
}

export interface WebhookResult {
  status: number;
  payload: Record<string, unknown>;
}

export async function handleStripeWebhook(
  input: { body: string; signature: string | null },
  deps: WebhookDeps,
): Promise<WebhookResult> {
  if (!deps.webhookSecret) {
    return { status: 503, payload: { error: "webhook_not_configured" } };
  }
  const now = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  if (!(await stripeSignatureValid(input.body, input.signature, deps.webhookSecret, now))) {
    return { status: 400, payload: { error: "invalid_signature" } };
  }
  let event: EventLike;
  try {
    event = JSON.parse(input.body) as EventLike;
  } catch {
    return { status: 400, payload: { error: "invalid_payload" } };
  }
  const patch = stripeEventPatch(event);
  if (!patch || Object.keys(patch.profile).length === 0) {
    return { status: 200, payload: { received: true, ignored: true } };
  }
  try {
    let userId = patch.userId;
    if (!userId && patch.customerId) userId = await deps.findUserByCustomer(patch.customerId);
    if (!userId) {
      // No user maps to this event — acknowledge so Stripe stops retrying.
      return { status: 200, payload: { received: true, ignored: true } };
    }
    await deps.applyProfilePatch(userId, patch.profile);
    return { status: 200, payload: { received: true } };
  } catch {
    // Transient (DB/network) — non-2xx so Stripe retries this delivery.
    return { status: 500, payload: { error: "apply_failed" } };
  }
}

// ---------------------------------------------------------------------------
// PostgREST wiring (service role)
// ---------------------------------------------------------------------------

export function createPostgrestDeps(opts: {
  url: string;
  serviceKey: string;
  webhookSecret: string | null;
  fetchFn?: typeof fetch;
}): WebhookDeps {
  const fetchFn = opts.fetchFn ?? fetch;
  const headers = (): Record<string, string> => ({
    apikey: opts.serviceKey,
    Authorization: `Bearer ${opts.serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  });
  const base = opts.url.replace(/\/+$/, "");
  return {
    webhookSecret: opts.webhookSecret,
    async findUserByCustomer(customerId: string): Promise<string | null> {
      const response = await fetchFn(
        `${base}/rest/v1/profiles?select=id&stripe_customer_id=eq.${encodeURIComponent(customerId)}&limit=1`,
        { headers: headers() },
      );
      if (!response.ok) throw new Error(`profiles lookup failed (${response.status})`);
      const rows = (await response.json()) as Array<{ id?: string }>;
      return rows[0]?.id ?? null;
    },
    async applyProfilePatch(userId: string, profile: Record<string, unknown>): Promise<void> {
      const response = await fetchFn(
        `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
        { method: "PATCH", headers: headers(), body: JSON.stringify(profile) },
      );
      if (!response.ok) throw new Error(`profiles update failed (${response.status})`);
    },
  };
}

// ---------------------------------------------------------------------------
// Edge entry (skipped outside Deno — vitest imports the pure parts above)
// ---------------------------------------------------------------------------

interface DenoLike {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
}

declare const Deno: DenoLike | undefined;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "stripe-signature, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

if (typeof Deno !== "undefined" && Deno) {
  Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }
    const body = await req.text();
    const deps = createPostgrestDeps({
      url: Deno.env.get("SUPABASE_URL") ?? "",
      serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      webhookSecret: Deno.env.get("STRIPE_WEBHOOK_SECRET") || null,
    });
    const result = await handleStripeWebhook(
      { body, signature: req.headers.get("stripe-signature") },
      deps,
    );
    return new Response(JSON.stringify(result.payload), {
      status: result.status,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  });
}
