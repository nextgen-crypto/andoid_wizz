import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStripePriceCache,
  createStripeApi,
  ensurePremiumPrice,
  isUuid,
  premiumPriceSettings,
  siteBaseUrl,
  stripeFormEncode,
  stripeIsConfigured,
  stripeSecretKey,
  subscriptionHasEnded,
  subscriptionIsActive,
  subscriptionPeriodEndISO,
  type StripeApi,
  type StripeFormParams,
} from "./stripe.helpers";

/**
 * Table-driven matrix for backend/api/stripe.helpers.ts — the layer every
 * Stripe call goes through. Pure helpers are pinned directly; the REST
 * client and the price bootstrap run against a scripted fetch/fake API so
 * request shapes (form encoding, headers, error surfacing) and the
 * explicit-id → lookup-key → create ordering are locked in.
 */

describe("stripeFormEncode", () => {
  const rows: Array<[label: string, input: StripeFormParams, expected: string]> = [
    ["flat scalars", { mode: "subscription", quantity: 1 }, "mode=subscription&quantity=1"],
    ["drops null", { a: null, b: "x" }, "b=x"],
    ["drops undefined", { a: undefined, b: "x" }, "b=x"],
    ["nested object", { metadata: { user_id: "u1" } }, "metadata[user_id]=u1"],
    ["boolean", { active: true }, "active=true"],
    [
      "array of objects",
      { line_items: [{ price: "p1", quantity: 2 }] },
      "line_items[0][price]=p1&line_items[0][quantity]=2",
    ],
    ["array of scalars", { lookup_keys: ["a", "b"] }, "lookup_keys[0]=a&lookup_keys[1]=b"],
    ["pre-indexed key passes through", { "expand[0]": "subscription" }, "expand[0]=subscription"],
    ["url-encodes values", { email: "a b+c@d.e" }, "email=a%20b%2Bc%40d.e"],
    ["empty params", {}, ""],
  ];

  it.each(rows)("%s → %s", (_label, input, expected) => {
    expect(stripeFormEncode(input)).toBe(expected);
  });
});

describe("stripeIsConfigured", () => {
  const rows: Array<[label: string, key: string | null | undefined, expected: boolean]> = [
    ["test key", "sk_test_abc123", true],
    ["live key", "sk_live_abc123", true],
    ["restricted key", "rk_live_abc123", true],
    ["null", null, false],
    ["undefined", undefined, false],
    ["empty", "", false],
    ["webhook secret", "whsec_abc", false],
    ["publishable key", "pk_live_abc", false],
    ["prefixed string", "Bearer sk_live_abc", false],
  ];

  it.each(rows)("%s → %s", (_label, key, expected) => {
    expect(stripeIsConfigured(key)).toBe(expected);
  });

  it("reads the key from the server environment by default", () => {
    const previous = process.env["STRIPE_SECRET_KEY"];
    process.env["STRIPE_SECRET_KEY"] = "sk_test_from_env";
    try {
      expect(stripeSecretKey()).toBe("sk_test_from_env");
      expect(stripeIsConfigured(stripeSecretKey())).toBe(true);
    } finally {
      if (previous === undefined) delete process.env["STRIPE_SECRET_KEY"];
      else process.env["STRIPE_SECRET_KEY"] = previous;
    }
  });
});

describe("premiumPriceSettings", () => {
  const rows: Array<
    [label: string, env: Record<string, string>, expected: { unitAmount: number; currency: string }]
  > = [
    ["defaults", {}, { unitAmount: 499, currency: "usd" }],
    [
      "explicit amount + currency",
      { STRIPE_PREMIUM_AMOUNT: "5000", STRIPE_CURRENCY: "TZS" },
      { unitAmount: 5000, currency: "tzs" },
    ],
    ["amount out of range", { STRIPE_PREMIUM_AMOUNT: "-5" }, { unitAmount: 499, currency: "usd" }],
    ["amount not a number", { STRIPE_PREMIUM_AMOUNT: "abc" }, { unitAmount: 499, currency: "usd" }],
    ["currency malformed", { STRIPE_CURRENCY: "nope1" }, { unitAmount: 499, currency: "usd" }],
    [
      "currency with amount override",
      { STRIPE_CURRENCY: "eur", STRIPE_PREMIUM_AMOUNT: "42" },
      { unitAmount: 42, currency: "eur" },
    ],
  ];

  it.each(rows)("%s", (_label, env, expected) => {
    expect(premiumPriceSettings(env)).toEqual(expected);
  });
});

describe("siteBaseUrl", () => {
  it("falls back to the production alias", () => {
    expect(siteBaseUrl({})).toBe("https://wizz-kohl.vercel.app");
  });
  it("uses SITE_URL when it is a real URL", () => {
    expect(siteBaseUrl({ SITE_URL: "https://example.test" })).toBe("https://example.test");
  });
  it("strips trailing slashes", () => {
    expect(siteBaseUrl({ SITE_URL: "https://example.test///" })).toBe("https://example.test");
  });
  it("rejects non-URLs", () => {
    expect(siteBaseUrl({ SITE_URL: "not a url" })).toBe("https://wizz-kohl.vercel.app");
  });
});

describe("subscriptionPeriodEndISO", () => {
  const iso = new Date(1794000000 * 1000).toISOString();
  const rows: Array<[label: string, input: unknown, expected: string | null]> = [
    ["legacy top-level field", { current_period_end: 1794000000 }, iso],
    [
      "item-level field (newer API)",
      { items: { data: [{ current_period_end: 1794000000 }] } },
      iso,
    ],
    ["missing", {}, null],
    ["not a number", { current_period_end: "soon" }, null],
    ["null input", null, null],
    ["not an object", "sub_1", null],
    ["empty items array", { items: { data: [] } }, null],
  ];

  it.each(rows)("%s → %s", (_label, input, expected) => {
    expect(subscriptionPeriodEndISO(input)).toBe(expected);
  });
});

describe("subscription status helpers", () => {
  const rows: Array<[status: string | undefined, active: boolean, ended: boolean]> = [
    ["active", true, false],
    ["trialing", true, false],
    ["past_due", false, false],
    ["incomplete", false, false],
    ["paused", false, false],
    ["canceled", false, true],
    ["incomplete_expired", false, true],
    ["unpaid", false, true],
    [undefined, false, false],
    ["", false, false],
  ];

  it.each(rows)("%s → active:%s ended:%s", (status, active, ended) => {
    expect(subscriptionIsActive(status)).toBe(active);
    expect(subscriptionHasEnded(status)).toBe(ended);
  });
});

describe("isUuid", () => {
  const rows: Array<[label: string, input: unknown, expected: boolean]> = [
    ["v4 uuid", "dcb8ffb3-ac98-4c69-b3b2-bde20cbd5559", true],
    ["uppercase", "DCB8FFB3-AC98-4C69-B3B2-BDE20CBD5559", true],
    ["session id", "cs_test_abc", false],
    ["wrong separator", "dcb8ffb3ac984c69b3b2bde20cbd5559", false],
    ["too short", "dcb8ffb3-ac98-4c69-b3b2", false],
    ["number", 42, false],
    ["null", null, false],
  ];

  it.each(rows)("%s → %s", (_label, input, expected) => {
    expect(isUuid(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// REST client
// ---------------------------------------------------------------------------

describe("createStripeApi", () => {
  function scriptedFetch(
    handler: (url: string, init?: RequestInit) => { status: number; body: unknown },
  ) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { status, body } = handler(String(input), init);
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    });
  }

  it("GETs with query params, bearer auth and no body", async () => {
    const fetchFn = scriptedFetch(() => ({ status: 200, body: { data: [] } }));
    const api = createStripeApi("sk_test_x", fetchFn as unknown as typeof fetch);
    await api.request("GET", "/prices", { "lookup_keys[0]": "k" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/prices?lookup_keys[0]=k");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk_test_x");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("POSTs form-encoded bodies without a query string", async () => {
    const fetchFn = scriptedFetch(() => ({ status: 200, body: { id: "cus_1" } }));
    const api = createStripeApi("sk_test_x", fetchFn as unknown as typeof fetch);
    await api.request("POST", "/customers", { email: "a@b.c", metadata: { user_id: "u1" } });
    const [url, init] = fetchFn.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/customers");
    expect(init.body).toBe("email=a%40b.c&metadata[user_id]=u1");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("surfaces Stripe's own error message", async () => {
    const fetchFn = scriptedFetch(() => ({
      status: 402,
      body: { error: { message: "Your card was declined." } },
    }));
    const api = createStripeApi("sk_test_x", fetchFn as unknown as typeof fetch);
    await expect(api.request("POST", "/charges", {})).rejects.toThrow("Your card was declined.");
  });

  it("falls back to a status message when Stripe sends none", async () => {
    const fetchFn = scriptedFetch(() => ({ status: 500, body: {} }));
    const api = createStripeApi("sk_test_x", fetchFn as unknown as typeof fetch);
    await expect(api.request("GET", "/me")).rejects.toThrow("Stripe request failed (500)");
  });

  it("returns the payload on 2xx", async () => {
    const fetchFn = scriptedFetch(() => ({ status: 200, body: { url: "https://pay" } }));
    const api = createStripeApi("sk_test_x", fetchFn as unknown as typeof fetch);
    await expect(api.request("GET", "/x")).resolves.toEqual({ url: "https://pay" });
  });
});

// ---------------------------------------------------------------------------
// Price bootstrap
// ---------------------------------------------------------------------------

describe("ensurePremiumPrice", () => {
  let calls: Array<{ method: string; path: string }>;
  let responses: Array<{ match: RegExp; method: string; body: unknown }>;

  function fakeApi(): StripeApi {
    return {
      request: (async (method: string, path: string) => {
        calls.push({ method, path });
        const hit = responses.find((r) => r.method === method && r.match.test(path));
        if (!hit) throw new Error(`unexpected request ${method} ${path}`);
        return hit.body;
      }) as StripeApi["request"],
    };
  }

  beforeEach(() => {
    calls = [];
    responses = [];
    clearStripePriceCache();
  });

  it("prefers an explicit STRIPE_PRICE_ID without touching Stripe", async () => {
    const api = fakeApi();
    await expect(ensurePremiumPrice(api, { STRIPE_PRICE_ID: "price_explicit" })).resolves.toBe(
      "price_explicit",
    );
    expect(calls).toHaveLength(0);
  });

  it("finds the recurring price by lookup key and caches it", async () => {
    responses.push({ match: /^\/prices$/, method: "GET", body: { data: [{ id: "price_found" }] } });
    const api = fakeApi();
    await expect(ensurePremiumPrice(api, {})).resolves.toBe("price_found");
    await expect(ensurePremiumPrice(api, {})).resolves.toBe("price_found");
    // Second call served from the warm cache — one lookup total.
    expect(calls).toEqual([{ method: "GET", path: "/prices" }]);
  });

  it("creates the product and a monthly price on first checkout", async () => {
    responses.push({ match: /^\/prices$/, method: "GET", body: { data: [] } });
    responses.push({ match: /^\/products$/, method: "POST", body: { id: "prod_wizz" } });
    responses.push({ match: /^\/prices$/, method: "POST", body: { id: "price_created" } });
    const api = fakeApi();
    await expect(ensurePremiumPrice(api, {})).resolves.toBe("price_created");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /prices",
      "POST /products",
      "POST /prices",
    ]);
  });

  it("honours amount/currency overrides when creating", async () => {
    responses.push({ match: /^\/prices$/, method: "GET", body: { data: [] } });
    responses.push({ match: /^\/products$/, method: "POST", body: { id: "prod_wizz" } });
    let posted = "";
    responses.push({ match: /^\/prices$/, method: "POST", body: { id: "price_created" } });
    const api: StripeApi = {
      request: (async (method: string, path: string) => {
        calls.push({ method, path });
        if (method === "POST" && path === "/prices") posted = "recorded";
        const hit = responses.find((r) => r.method === method && r.match.test(path));
        if (!hit) throw new Error(`unexpected request ${method} ${path}`);
        return hit.body;
      }) as StripeApi["request"],
    };
    await expect(
      ensurePremiumPrice(api, { STRIPE_PREMIUM_AMOUNT: "5000", STRIPE_CURRENCY: "tzs" }),
    ).resolves.toBe("price_created");
    expect(posted).toBe("recorded");
  });

  it("clearing the cache forces a fresh lookup", async () => {
    responses.push({ match: /^\/prices$/, method: "GET", body: { data: [{ id: "price_a" }] } });
    const api = fakeApi();
    await ensurePremiumPrice(api, {});
    clearStripePriceCache();
    await ensurePremiumPrice(api, {});
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(2);
  });
});
