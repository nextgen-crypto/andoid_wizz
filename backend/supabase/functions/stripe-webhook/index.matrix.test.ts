import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  createPostgrestDeps,
  handleStripeWebhook,
  parseStripeSignature,
  stripeEventPatch,
  stripeSignatureValid,
} from "./index";

/**
 * Table-driven matrix for the Stripe webhook edge function. The signature
 * check uses a real HMAC (same bytes Stripe would send), the event mapping
 * is pinned event-by-event, and the handler flows run against recorded
 * deps — so the paid-only grant/revoke rules are locked before the function
 * ever sees live traffic.
 */

const SECRET = "whsec_test_matrix";
const NOW = 1_800_000_000;
const USER = "dcb8ffb3-ac98-4c69-b3b2-bde20cbd5559";
const OTHER_USER = "11111111-2222-3333-4444-555555555555";
const PERIOD_END = 1_794_000_000;
const PERIOD_ISO = new Date(PERIOD_END * 1000).toISOString();

function sign(payload: string, timestamp: number, secret = SECRET): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

// ---------------------------------------------------------------------------
// Signature parsing + verification
// ---------------------------------------------------------------------------

describe("parseStripeSignature", () => {
  it("extracts the timestamp and every v1 candidate", () => {
    expect(parseStripeSignature("t=123,v1=aaa,v1=bbb")).toEqual({
      timestamp: 123,
      signatures: ["aaa", "bbb"],
    });
  });

  it("tolerates surrounding spaces", () => {
    expect(parseStripeSignature(" t=123 , v1=aaa ")).toEqual({
      timestamp: 123,
      signatures: ["aaa"],
    });
  });

  const bad: Array<[label: string, header: string | null | undefined]> = [
    ["missing", null],
    ["undefined", undefined],
    ["empty", ""],
    ["no timestamp", "v1=aaa"],
    ["no signature", "t=123"],
    ["garbage", "not-a-signature"],
    ["non-numeric timestamp", "t=abc,v1=aaa"],
  ];

  it.each(bad)("%s header → null", (_label, header) => {
    expect(parseStripeSignature(header)).toBeNull();
  });
});

describe("stripeSignatureValid", () => {
  const payload = JSON.stringify({ type: "customer.subscription.updated" });

  it("accepts the exact payload Stripe signed", async () => {
    await expect(stripeSignatureValid(payload, sign(payload, NOW), SECRET, NOW)).resolves.toBe(
      true,
    );
  });

  it("rejects a tampered body", async () => {
    await expect(
      stripeSignatureValid(payload + " ", sign(payload, NOW), SECRET, NOW),
    ).resolves.toBe(false);
  });

  it("rejects the wrong secret", async () => {
    await expect(
      stripeSignatureValid(payload, sign(payload, NOW, "whsec_other"), SECRET, NOW),
    ).resolves.toBe(false);
  });

  it("rejects a replayed timestamp outside the 5-minute tolerance", async () => {
    const stale = sign(payload, NOW - 301);
    await expect(stripeSignatureValid(payload, stale, SECRET, NOW)).resolves.toBe(false);
  });

  it("accepts a timestamp exactly at the tolerance edge, rejects beyond", async () => {
    await expect(
      stripeSignatureValid(payload, sign(payload, NOW - 300), SECRET, NOW),
    ).resolves.toBe(true);
    await expect(
      stripeSignatureValid(payload, sign(payload, NOW + 301), SECRET, NOW),
    ).resolves.toBe(false);
  });

  it("matches when a rotated candidate among several is correct", async () => {
    const header = `t=${NOW},v1=deadbeef,${sign(payload, NOW).split(",")[1]}`;
    await expect(stripeSignatureValid(payload, header, SECRET, NOW)).resolves.toBe(true);
  });

  const rejects: Array<[label: string, header: null | undefined | string, secret: string]> = [
    ["missing header", null, SECRET],
    ["empty secret", `t=${NOW},v1=abc`, ""],
    ["garbage header", "v1=abc", SECRET],
  ];

  it.each(rejects)("%s → false", async (_label, header, secret) => {
    await expect(stripeSignatureValid(payload, header, secret, NOW)).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Event → profile patch
// ---------------------------------------------------------------------------

describe("stripeEventPatch", () => {
  it("maps checkout completion to the customer/subscription ids", () => {
    const patch = stripeEventPatch({
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: USER,
          customer: "cus_SAME",
          subscription: "sub_NEW",
        },
      },
    });
    expect(patch).toEqual({
      userId: USER,
      customerId: "cus_SAME",
      profile: { stripe_customer_id: "cus_SAME", stripe_subscription_id: "sub_NEW" },
    });
  });

  it("prefers subscription metadata over the session reference", () => {
    const patch = stripeEventPatch({
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: USER,
          metadata: { user_id: OTHER_USER },
          customer: "cus_SAME",
          subscription: "sub_NEW",
        },
      },
    });
    expect(patch?.userId).toBe(OTHER_USER);
  });

  it("ignores a checkout completion with no subscription to track", () => {
    expect(
      stripeEventPatch({
        type: "checkout.session.completed",
        data: { object: { client_reference_id: USER } },
      }),
    ).toBeNull();
  });

  const active: Array<[label: string, subscription: Record<string, unknown>]> = [
    ["legacy top-level period", { current_period_end: PERIOD_END }],
    ["item-level period", { items: { data: [{ current_period_end: PERIOD_END }] } }],
  ];

  it.each(active)("grants period + badge for an active subscription (%s)", (_label, sub) => {
    const patch = stripeEventPatch({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_NEW",
          customer: "cus_SAME",
          status: "active",
          cancel_at_period_end: false,
          metadata: { user_id: USER },
          ...sub,
        },
      },
    });
    expect(patch?.userId).toBe(USER);
    expect(patch?.profile).toMatchObject({
      premium_until: PERIOD_ISO,
      verified: true,
      stripe_subscription_id: "sub_NEW",
      stripe_customer_id: "cus_SAME",
      premium_cancel_at_period_end: false,
    });
  });

  it("keeps ids only when an active subscription reports no period", () => {
    const patch = stripeEventPatch({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_NEW", customer: "cus_SAME", status: "active" } },
    });
    expect(patch?.profile).not.toHaveProperty("premium_until");
    expect(patch?.profile).not.toHaveProperty("verified");
    expect(patch?.profile).toMatchObject({ stripe_subscription_id: "sub_NEW" });
  });

  const dunning: Array<[label: string, status: string]> = [
    ["past_due", "past_due"],
    ["incomplete", "incomplete"],
    ["paused", "paused"],
  ];

  it.each(dunning)(
    "keeps access during dunning (%s) — ids only, no badge change",
    (_label, status) => {
      const patch = stripeEventPatch({
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_NEW",
            customer: "cus_SAME",
            status,
            current_period_end: PERIOD_END,
            cancel_at_period_end: false,
            metadata: { user_id: USER },
          },
        },
      });
      expect(patch?.profile).not.toHaveProperty("premium_until");
      expect(patch?.profile).not.toHaveProperty("verified");
    },
  );

  const terminal: Array<[label: string, status: string]> = [
    ["canceled", "canceled"],
    ["unpaid", "unpaid"],
    ["incomplete_expired", "incomplete_expired"],
  ];

  it.each(terminal)("revokes period + badge for a terminal status (%s)", (_label, status) => {
    const patch = stripeEventPatch({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_NEW",
          customer: "cus_SAME",
          status,
          cancel_at_period_end: true,
          metadata: { user_id: USER },
        },
      },
    });
    expect(patch?.profile).toEqual({
      stripe_subscription_id: "sub_NEW",
      stripe_customer_id: "cus_SAME",
      premium_until: null,
      verified: false,
      premium_cancel_at_period_end: false,
    });
  });

  it("records cancel_at_period_end when the subscriber cancels mid-period", () => {
    const patch = stripeEventPatch({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_NEW",
          customer: "cus_SAME",
          status: "active",
          current_period_end: PERIOD_END,
          cancel_at_period_end: true,
          metadata: { user_id: USER },
        },
      },
    });
    expect(patch?.profile).toMatchObject({
      premium_cancel_at_period_end: true,
      premium_until: PERIOD_ISO,
      verified: true,
    });
  });

  it("revokes everything on subscription deletion", () => {
    const patch = stripeEventPatch({
      type: "customer.subscription.deleted",
      data: {
        object: { id: "sub_NEW", customer: "cus_SAME", metadata: { user_id: USER } },
      },
    });
    expect(patch).toEqual({
      userId: USER,
      customerId: "cus_SAME",
      profile: {
        stripe_subscription_id: null,
        premium_until: null,
        verified: false,
        premium_cancel_at_period_end: false,
      },
    });
  });

  it("ignores metadata that is not one of our account ids", () => {
    const patch = stripeEventPatch({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_NEW",
          customer: "cus_SAME",
          status: "active",
          current_period_end: PERIOD_END,
          metadata: { user_id: "suspicious-string" },
        },
      },
    });
    expect(patch?.userId).toBeNull();
    expect(patch?.customerId).toBe("cus_SAME");
  });

  const ignored: Array<[label: string, event: unknown]> = [
    ["unhandled event type", { type: "invoice.paid", data: { object: {} } }],
    ["missing data", { type: "customer.subscription.updated" }],
    ["missing type", { data: { object: { id: "sub_1" } } }],
    ["null event", null],
  ];

  it.each(ignored)("%s → no patch", (_label, event) => {
    expect(stripeEventPatch(event as never)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Handler flows
// ---------------------------------------------------------------------------

function recordedDeps(
  overrides: Partial<{
    webhookSecret: string | null;
    findResult: string | null;
    applyError: Error;
  }> = {},
) {
  const found: string[] = [];
  const applied: Array<{ userId: string; profile: Record<string, unknown> }> = [];
  const deps = {
    webhookSecret: overrides.webhookSecret !== undefined ? overrides.webhookSecret : SECRET,
    findUserByCustomer: vi.fn(async (customerId: string) => {
      found.push(customerId);
      return overrides.findResult ?? null;
    }),
    applyProfilePatch: vi.fn(async (userId: string, profile: Record<string, unknown>) => {
      if (overrides.applyError) throw overrides.applyError;
      applied.push({ userId, profile });
    }),
    nowSeconds: () => NOW,
  };
  return { deps, found, applied };
}

describe("handleStripeWebhook", () => {
  const activeEvent = JSON.stringify({
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_NEW",
        customer: "cus_SAME",
        status: "active",
        current_period_end: PERIOD_END,
        cancel_at_period_end: false,
        metadata: { user_id: USER },
      },
    },
  });

  it("fails closed (503) when no signing secret is configured", async () => {
    const { deps, applied } = recordedDeps({ webhookSecret: null });
    const result = await handleStripeWebhook(
      { body: activeEvent, signature: sign(activeEvent, NOW) },
      deps,
    );
    expect(result.status).toBe(503);
    expect(applied).toHaveLength(0);
  });

  it("rejects an unsigned or forged delivery (400) without touching the DB", async () => {
    const { deps, found, applied } = recordedDeps();
    for (const signature of [null, "t=1,v1=deadbeef", `t=${NOW},v1=deadbeef`]) {
      const result = await handleStripeWebhook({ body: activeEvent, signature }, deps);
      expect(result.status).toBe(400);
    }
    expect(found).toHaveLength(0);
    expect(applied).toHaveLength(0);
  });

  it("applies an active-period grant to the account from metadata", async () => {
    const { deps, found, applied } = recordedDeps();
    const result = await handleStripeWebhook(
      { body: activeEvent, signature: sign(activeEvent, NOW) },
      deps,
    );
    expect(result).toEqual({ status: 200, payload: { received: true } });
    expect(found).toHaveLength(0); // metadata resolved it — no lookup needed
    expect(applied).toEqual([
      {
        userId: USER,
        profile: expect.objectContaining({
          premium_until: PERIOD_ISO,
          verified: true,
          stripe_subscription_id: "sub_NEW",
        }),
      },
    ]);
  });

  it("falls back to the customer id when metadata is absent", async () => {
    const body = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { customer: "cus_SAME", subscription: "sub_NEW" } },
    });
    const { deps, found, applied } = recordedDeps({ findResult: "uid-DB" });
    const result = await handleStripeWebhook({ body, signature: sign(body, NOW) }, deps);
    expect(result.status).toBe(200);
    expect(found).toEqual(["cus_SAME"]);
    expect(applied).toEqual([
      {
        userId: "uid-DB",
        profile: { stripe_customer_id: "cus_SAME", stripe_subscription_id: "sub_NEW" },
      },
    ]);
  });

  it("acknowledges events that map to nobody instead of retrying forever", async () => {
    const body = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { customer: "cus_UNKNOWN", subscription: "sub_NEW" } },
    });
    const { deps, applied } = recordedDeps({ findResult: null });
    const result = await handleStripeWebhook({ body, signature: sign(body, NOW) }, deps);
    expect(result).toEqual({ status: 200, payload: { received: true, ignored: true } });
    expect(applied).toHaveLength(0);
  });

  it("acknowledges unhandled event types", async () => {
    const body = JSON.stringify({ type: "invoice.paid", data: { object: {} } });
    const { deps } = recordedDeps();
    const result = await handleStripeWebhook({ body, signature: sign(body, NOW) }, deps);
    expect(result).toEqual({ status: 200, payload: { received: true, ignored: true } });
  });

  it("rejects a signed body that is not JSON (400)", async () => {
    const body = "{not json";
    const { deps, applied } = recordedDeps();
    const result = await handleStripeWebhook({ body, signature: sign(body, NOW) }, deps);
    expect(result).toEqual({ status: 400, payload: { error: "invalid_payload" } });
    expect(applied).toHaveLength(0);
  });

  it("returns 500 when the write fails so Stripe retries the delivery", async () => {
    const { deps } = recordedDeps({ applyError: new Error("db down") });
    const result = await handleStripeWebhook(
      { body: activeEvent, signature: sign(activeEvent, NOW) },
      deps,
    );
    expect(result).toEqual({ status: 500, payload: { error: "apply_failed" } });
  });
});

// ---------------------------------------------------------------------------
// PostgREST wiring
// ---------------------------------------------------------------------------

describe("createPostgrestDeps", () => {
  function scriptedFetch(
    handler: (url: string, init?: RequestInit) => { status: number; body: unknown },
  ) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { status, body } = handler(String(input), init);
      // 204 must not carry a body — PostgREST answers exactly like that.
      return new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    });
  }

  it("looks a user up by stripe_customer_id with service-role headers", async () => {
    const fetchFn = scriptedFetch(() => ({ status: 200, body: [{ id: "uid-DB" }] }));
    const deps = createPostgrestDeps({
      url: "https://proj.supabase.co/",
      serviceKey: "sb_secret_x",
      webhookSecret: SECRET,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(deps.findUserByCustomer("cus_1")).resolves.toBe("uid-DB");
    const [url, init] = fetchFn.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      "https://proj.supabase.co/rest/v1/profiles?select=id&stripe_customer_id=eq.cus_1&limit=1",
    );
    expect((init.headers as Record<string, string>)["apikey"]).toBe("sb_secret_x");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sb_secret_x");
    expect(deps.webhookSecret).toBe(SECRET);
  });

  it("returns null when no profile holds the customer id", async () => {
    const fetchFn = scriptedFetch(() => ({ status: 200, body: [] }));
    const deps = createPostgrestDeps({
      url: "https://proj.supabase.co",
      serviceKey: "k",
      webhookSecret: SECRET,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(deps.findUserByCustomer("cus_1")).resolves.toBeNull();
  });

  it("throws on a failed lookup so the handler answers 500 and Stripe retries", async () => {
    const fetchFn = scriptedFetch(() => ({ status: 500, body: {} }));
    const deps = createPostgrestDeps({
      url: "https://proj.supabase.co",
      serviceKey: "k",
      webhookSecret: SECRET,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(deps.findUserByCustomer("cus_1")).rejects.toThrow("profiles lookup failed (500)");
  });

  it("PATCHes the profile patch as the service role", async () => {
    const fetchFn = scriptedFetch(() => ({ status: 204, body: {} }));
    const deps = createPostgrestDeps({
      url: "https://proj.supabase.co",
      serviceKey: "k",
      webhookSecret: SECRET,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await deps.applyProfilePatch(USER, { verified: true, premium_until: PERIOD_ISO });
    const [url, init] = fetchFn.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`https://proj.supabase.co/rest/v1/profiles?id=eq.${USER}`);
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ verified: true, premium_until: PERIOD_ISO }));
    expect((init.headers as Record<string, string>)["Prefer"]).toBe("return=minimal");
  });

  it("throws on a failed patch so the delivery is retried", async () => {
    const fetchFn = scriptedFetch(() => ({ status: 403, body: {} }));
    const deps = createPostgrestDeps({
      url: "https://proj.supabase.co",
      serviceKey: "k",
      webhookSecret: SECRET,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(deps.applyProfilePatch(USER, { verified: false })).rejects.toThrow(
      "profiles update failed (403)",
    );
  });
});
