import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearStripePriceCache } from "./stripe.helpers";

/**
 * Table-driven matrix for backend/api/billing.functions.ts plus the
 * Stripe-aware paths of subscriptions.functions.ts.
 *
 * Harness: createServerFn with middleware + validator (repo-standard), a
 * fixed auth context (uid + email claims), the scripted service-role
 * recorder from the subscriptions matrix, and a scripted `fetch` standing in
 * for api.stripe.com. `STRIPE_SECRET_KEY` selects the mode, so every case is
 * deterministic and offline:
 *
 *   no key  → labelled preview activation (today's behaviour, unchanged)
 *   key     → checkout/resume/confirm flows; nothing self-grants
 */

// ---------------------------------------------------------------------------
// Harness: createServerFn with middleware + exposed validator
// ---------------------------------------------------------------------------

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tanstack/react-start")>();
  interface ServerFnBuilder {
    _middleware: unknown[];
    _validator: ((data: unknown) => unknown) | null;
    middleware(mws: unknown[]): ServerFnBuilder;
    validator(validator: (data: unknown) => unknown): ServerFnBuilder;
    handler(
      fn: (args: { context: unknown; data: unknown }) => unknown,
    ): (opts?: { data?: unknown }) => Promise<unknown>;
  }
  const createServerFn = (): ServerFnBuilder => {
    const builder: ServerFnBuilder = {
      _middleware: [],
      _validator: null,
      middleware(mws) {
        builder._middleware = [...builder._middleware, ...mws];
        return builder;
      },
      validator(validator) {
        builder._validator = validator;
        return builder;
      },
      handler(fn) {
        const callable = async ({ data }: { data?: unknown } = {}) => {
          const context: Record<string, unknown> = {};
          for (const mw of builder._middleware) {
            const server = (mw as { _server?: (ctx: unknown) => Promise<void> })._server;
            if (!server) throw new Error("middleware is not a server middleware");
            await server({
              context,
              next: async (nextCtx?: Record<string, unknown>) => {
                if (nextCtx?.["context"]) Object.assign(context, nextCtx["context"]);
              },
            });
          }
          const validated = builder._validator ? builder._validator(data) : data;
          return fn({ context, data: validated });
        };
        (callable as { _validator?: unknown })._validator = builder._validator;
        return callable;
      },
    };
    return builder;
  };
  return { ...original, createServerFn };
});

// Auth middleware: fixed account context (uid + email), no HTTP, no Supabase.
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: {
    _server: async ({ next }: { next: (ctx?: unknown) => Promise<void> }) =>
      next({
        context: {
          userId: "uid-TEST",
          claims: { sub: "uid-TEST", email: "apitest-wizz@example.com" },
        },
      }),
  },
}));

// ---------------------------------------------------------------------------
// Scripted service-role client (state-mutating chains)
// ---------------------------------------------------------------------------

type DbCall = { table: string; op: string; payload?: unknown };

const db = {
  calls: [] as DbCall[],
  profiles: { data: null as Record<string, unknown> | null, error: null as unknown },
  updateError: null as unknown,
};

function resetDb(): void {
  db.calls = [];
  db.profiles = { data: null, error: null };
  db.updateError = null;
}

function callsTo(table: string, op: string): unknown[] {
  return db.calls.filter((c) => c.table === table && c.op === op).map((c) => c.payload);
}

function eqChain(op: string, apply: () => void) {
  const chain = {
    eq: () => chain,
    then: (onF?: (v: { error: unknown }) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve({ error: op === "update" ? db.updateError : null })
        .then((res) => {
          if (res.error == null) apply();
          return res;
        })
        .then(onF, onR),
  };
  return chain;
}

const supabaseAdmin = {
  from: (table: string) => ({
    select: (...args: unknown[]) => {
      db.calls.push({ table, op: "select", payload: args });
      const chain = {
        eq: () => chain,
        maybeSingle: async () => db.profiles,
      };
      return chain;
    },
    update: (payload: unknown) => {
      db.calls.push({ table, op: "update", payload });
      return eqChain("update", () => {
        if (table === "profiles") Object.assign(db.profiles.data ?? {}, payload);
      });
    },
    delete: () => {
      db.calls.push({ table, op: "delete" });
      return eqChain("delete", () => undefined);
    },
    insert: (payload: unknown) => {
      db.calls.push({ table, op: "insert", payload });
      return Promise.resolve({ error: null });
    },
  }),
};

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

// ---------------------------------------------------------------------------
// Scripted api.stripe.com
// ---------------------------------------------------------------------------

type Route = { method: string; match: RegExp; status?: number; body: unknown };

let fetchRoutes: Route[] = [];
let fetchCalls: Array<{ url: string; method: string; body: string | null }> = [];

function fetchCall(index: number): { url: string; method: string; body: string | null } {
  const call = fetchCalls[index];
  if (!call) throw new Error(`no fetch call #${index} (got ${fetchCalls.length})`);
  return call;
}

function decodedBody(index: number): string {
  return decodeURIComponent(fetchCall(index).body ?? "");
}

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? init.body : null;
      fetchCalls.push({ url, method, body });
      const hit = fetchRoutes.find((r) => r.method === method && r.match.test(url));
      if (!hit) throw new Error(`unexpected stripe call: ${method} ${url}`);
      return new Response(JSON.stringify(hit.body ?? {}), {
        status: hit.status ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Env + module state reset
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_ID",
  "SITE_URL",
  "STRIPE_PREMIUM_AMOUNT",
  "STRIPE_CURRENCY",
] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  resetDb();
  fetchRoutes = [];
  fetchCalls = [];
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  clearStripePriceCache();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function stripeOn(): void {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_matrix";
}

const subs = await import("./subscriptions.functions");
const billing = await import("./billing.functions");

type Callable = ((opts?: { data?: unknown }) => Promise<unknown>) & {
  _validator?: (data: unknown) => unknown;
};

function invoke(fn: unknown, data?: unknown): Promise<unknown> {
  return (fn as Callable)({ data });
}

const FUTURE = "2026-12-19T12:00:00.000Z";
const PERIOD_END = 1794000000; // 2026-11-05T08:00:00Z
const PERIOD_ISO = new Date(PERIOD_END * 1000).toISOString();

function freshProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    verified: false,
    premium_until: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    premium_cancel_at_period_end: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// startPremiumSubscription
// ---------------------------------------------------------------------------

describe("startPremiumSubscription — preview mode (no Stripe key)", () => {
  it("grants the labelled 30-day preview without touching Stripe", async () => {
    db.profiles = { data: freshProfile(), error: null };
    const res = (await invoke(billing.startPremiumSubscription)) as {
      checkoutUrl: string | null;
      mode: string;
    };
    expect(res).toEqual({ checkoutUrl: null, mode: "preview" });
    const writes = callsTo("profiles", "update") as { premium_until: string; verified: boolean }[];
    expect(writes).toHaveLength(1);
    const delta = Date.parse(writes[0]!.premium_until) - Date.now();
    expect(delta).toBeGreaterThan(30 * 86_400_000 - 5_000);
    expect(delta).toBeLessThan(30 * 86_400_000 + 5_000);
    expect(writes[0]!.verified).toBe(true);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("startPremiumSubscription — Stripe mode", () => {
  it("creates customer + price + checkout session for a fresh account", async () => {
    stripeOn();
    db.profiles = { data: freshProfile(), error: null };
    fetchRoutes = [
      { method: "POST", match: /\/v1\/customers$/, body: { id: "cus_NEW" } },
      { method: "GET", match: /\/v1\/prices\?/, body: { data: [{ id: "price_ok" }] } },
      {
        method: "POST",
        match: /\/v1\/checkout\/sessions$/,
        body: { url: "https://checkout.stripe.com/pay/cs_test_X" },
      },
    ];
    const res = (await invoke(billing.startPremiumSubscription)) as {
      checkoutUrl: string | null;
      mode: string;
    };
    expect(res).toEqual({
      checkoutUrl: "https://checkout.stripe.com/pay/cs_test_X",
      mode: "stripe",
    });

    // Customer carries the account email + id for webhook mapping.
    const customer = decodedBody(0);
    expect(customer).toContain("email=apitest-wizz@example.com");
    expect(customer).toContain("metadata[user_id]=uid-TEST");

    // Session: subscription mode, our price, ids stamped on both objects,
    // and return URLs pointing at the checkout route.
    const session = decodedBody(2);
    expect(session).toContain("mode=subscription");
    expect(session).toContain("customer=cus_NEW");
    expect(session).toContain("line_items[0][price]=price_ok");
    expect(session).toContain("line_items[0][quantity]=1");
    expect(session).toContain("client_reference_id=uid-TEST");
    expect(session).toContain("metadata[product]=wizz_premium");
    expect(session).toContain("subscription_data[metadata][user_id]=uid-TEST");
    expect(session).toContain(
      "success_url=https://wizz-kohl.vercel.app/checkout?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(session).toContain("cancel_url=https://wizz-kohl.vercel.app/checkout?cancelled=1");

    // The customer id is persisted for later events — but never the period:
    // in Stripe mode only payment can grant it.
    const updates = callsTo("profiles", "update") as Record<string, unknown>[];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ stripe_customer_id: "cus_NEW" });
    expect(updates.some((u) => "premium_until" in u)).toBe(false);
  });

  it("reuses the stored customer id instead of creating another", async () => {
    stripeOn();
    db.profiles = { data: freshProfile({ stripe_customer_id: "cus_SAME" }), error: null };
    fetchRoutes = [
      { method: "GET", match: /\/v1\/prices\?/, body: { data: [{ id: "price_ok" }] } },
      {
        method: "POST",
        match: /\/v1\/checkout\/sessions$/,
        body: { url: "https://pay/cs_test_Y" },
      },
    ];
    const res = (await invoke(billing.startPremiumSubscription)) as { checkoutUrl: string | null };
    expect(res.checkoutUrl).toBe("https://pay/cs_test_Y");
    // No customers call was made — a stray one would have thrown (no route).
    expect(fetchCalls.filter((c) => c.url.endsWith("/customers"))).toHaveLength(0);
    expect(decodedBody(1)).toContain("customer=cus_SAME");
  });

  it("resumes a cancelled subscription instead of checking out twice", async () => {
    stripeOn();
    db.profiles = {
      data: freshProfile({ stripe_subscription_id: "sub_X", stripe_customer_id: "cus_SAME" }),
      error: null,
    };
    fetchRoutes = [
      {
        method: "POST",
        match: /\/v1\/subscriptions\/sub_X$/,
        body: {
          id: "sub_X",
          status: "active",
          customer: "cus_SAME",
          current_period_end: PERIOD_END,
          cancel_at_period_end: false,
        },
      },
    ];
    const res = (await invoke(billing.startPremiumSubscription)) as {
      checkoutUrl: string | null;
      mode: string;
    };
    // Un-cancelled — nothing to buy.
    expect(res).toEqual({ checkoutUrl: null, mode: "stripe" });
    expect(fetchCall(0).body).toContain("cancel_at_period_end=false");
    // The API answer is authoritative: the period (and badge) land from it,
    // which also heals accounts whose first checkout never got a webhook.
    const updates = callsTo("profiles", "update") as Record<string, unknown>[];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      premium_until: PERIOD_ISO,
      verified: true,
      stripe_subscription_id: "sub_X",
      stripe_customer_id: "cus_SAME",
      premium_cancel_at_period_end: false,
    });
    expect(fetchCalls.filter((c) => c.url.includes("/checkout/sessions"))).toHaveLength(0);
  });

  it("drops a stale subscription reference and checks out fresh", async () => {
    stripeOn();
    db.profiles = {
      data: freshProfile({ stripe_subscription_id: "sub_GONE", stripe_customer_id: "cus_SAME" }),
      error: null,
    };
    fetchRoutes = [
      {
        method: "POST",
        match: /\/v1\/subscriptions\/sub_GONE$/,
        status: 404,
        body: { error: { message: "No such subscription" } },
      },
      { method: "GET", match: /\/v1\/prices\?/, body: { data: [{ id: "price_ok" }] } },
      {
        method: "POST",
        match: /\/v1\/checkout\/sessions$/,
        body: { url: "https://pay/cs_test_Z" },
      },
    ];
    const res = (await invoke(billing.startPremiumSubscription)) as { checkoutUrl: string | null };
    expect(res.checkoutUrl).toBe("https://pay/cs_test_Z");
    const updates = callsTo("profiles", "update") as Record<string, unknown>[];
    // Stale id cleared first, then only the customer/session work happens —
    // still no local period grant.
    expect(updates[0]).toEqual({
      stripe_subscription_id: null,
      premium_cancel_at_period_end: false,
    });
    expect(updates.some((u) => "premium_until" in u)).toBe(false);
  });

  it("buys nothing when the period is already active", async () => {
    stripeOn();
    db.profiles = { data: freshProfile({ premium_until: FUTURE, verified: true }), error: null };
    const res = (await invoke(billing.startPremiumSubscription)) as { checkoutUrl: string | null };
    expect(res.checkoutUrl).toBeNull();
    expect(fetchCalls).toHaveLength(0);
    expect(callsTo("profiles", "update")).toHaveLength(0);
  });

  it("surfaces a Stripe failure instead of pretending to subscribe", async () => {
    stripeOn();
    db.profiles = { data: freshProfile(), error: null };
    fetchRoutes = [
      {
        method: "POST",
        match: /\/v1\/customers$/,
        status: 401,
        body: { error: { message: "Invalid API Key provided" } },
      },
    ];
    await expect(invoke(billing.startPremiumSubscription)).rejects.toThrow(
      "Invalid API Key provided",
    );
    expect(callsTo("profiles", "update")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// activatePremium guard
// ---------------------------------------------------------------------------

describe("activatePremium under Stripe mode", () => {
  it("refuses to self-grant when a secret key is configured", async () => {
    stripeOn();
    db.profiles = { data: freshProfile(), error: null };
    const res = (await invoke(subs.activatePremium)) as { premiumActive: boolean; billing: string };
    expect(callsTo("profiles", "update")).toHaveLength(0);
    expect(res).toMatchObject({ premiumActive: false, billing: "stripe" });
  });

  it("keeps granting in preview mode (the default)", async () => {
    db.profiles = { data: freshProfile(), error: null };
    const res = (await invoke(subs.activatePremium)) as { premiumActive: boolean; billing: string };
    expect(callsTo("profiles", "update")).toHaveLength(1);
    expect(res).toMatchObject({ premiumActive: true, billing: "preview" });
  });
});

// ---------------------------------------------------------------------------
// billing mode in the read path
// ---------------------------------------------------------------------------

describe("fetchMySubscription — billing mode", () => {
  it.each([
    ["with a secret key", true, "stripe"],
    ["without a key", false, "preview"],
  ])("%s → billing:%s", async (_label, withKey, expected) => {
    if (withKey) stripeOn();
    db.profiles = { data: freshProfile(), error: null };
    const res = (await invoke(subs.fetchMySubscription)) as { billing: string; live: boolean };
    expect(res).toMatchObject({ billing: expected, live: true });
  });

  it("reports offline as preview so the UI falls back to local state", async () => {
    db.profiles = { data: null, error: new Error("schema missing") };
    const res = (await invoke(subs.fetchMySubscription)) as { billing: string; live: boolean };
    expect(res).toMatchObject({ billing: "preview", live: false });
  });
});

// ---------------------------------------------------------------------------
// cancelPremium — Stripe branch
// ---------------------------------------------------------------------------

describe("cancelPremium", () => {
  it("stops the Stripe renewal but keeps the paid period (and badge)", async () => {
    stripeOn();
    db.profiles = {
      data: freshProfile({
        stripe_subscription_id: "sub_X",
        premium_until: FUTURE,
        verified: true,
      }),
      error: null,
    };
    fetchRoutes = [
      {
        method: "POST",
        match: /\/v1\/subscriptions\/sub_X$/,
        body: { id: "sub_X", cancel_at_period_end: true },
      },
    ];
    const res = (await invoke(subs.cancelPremium)) as {
      premiumActive: boolean;
      cancelAtPeriodEnd: boolean;
      verified: boolean;
    };
    expect(fetchCall(0).body).toContain("cancel_at_period_end=true");
    // Only the flag is written locally — the period is NOT torn down.
    const updates = callsTo("profiles", "update") as Record<string, unknown>[];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ premium_cancel_at_period_end: true });
    expect(res).toMatchObject({ premiumActive: true, cancelAtPeriodEnd: true, verified: true });
  });

  it("throws (no silent half-cancel) when the Stripe call fails", async () => {
    stripeOn();
    db.profiles = {
      data: freshProfile({
        stripe_subscription_id: "sub_X",
        premium_until: FUTURE,
        verified: true,
      }),
      error: null,
    };
    fetchRoutes = [
      {
        method: "POST",
        match: /\/v1\/subscriptions\/sub_X$/,
        status: 500,
        body: { error: { message: "Stripe unavailable" } },
      },
    ];
    await expect(invoke(subs.cancelPremium)).rejects.toThrow("Stripe unavailable");
    // Access untouched — they are still billed, so the badge must stay.
    expect(callsTo("profiles", "update")).toHaveLength(0);
  });

  it("clears period + badge + flag together in preview mode", async () => {
    db.profiles = {
      data: freshProfile({ premium_until: FUTURE, verified: true }),
      error: null,
    };
    const res = (await invoke(subs.cancelPremium)) as {
      premiumActive: boolean;
      verified: boolean;
    };
    expect(callsTo("profiles", "update")).toEqual([
      { premium_until: null, verified: false, premium_cancel_at_period_end: false },
    ]);
    expect(res).toMatchObject({ premiumActive: false, verified: false });
  });
});

// ---------------------------------------------------------------------------
// confirmPremiumCheckout — the unauthenticated return-page confirm
// ---------------------------------------------------------------------------

function paidSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "subscription",
    status: "complete",
    payment_status: "paid",
    client_reference_id: "dcb8ffb3-ac98-4c69-b3b2-bde20cbd5559",
    customer: "cus_SAME",
    metadata: { product: "wizz_premium" },
    subscription: {
      id: "sub_NEW",
      status: "active",
      customer: "cus_SAME",
      current_period_end: PERIOD_END,
      cancel_at_period_end: false,
    },
    ...overrides,
  };
}

describe("confirmPremiumCheckout", () => {
  const sessionId = "cs_test_aBcDeFgHiJkL";

  it("rejects malformed session ids before calling Stripe", async () => {
    stripeOn();
    for (const bad of ["", "not_cs", "cs_../../etc", "cs_test with space", 42]) {
      const res = (await invoke(billing.confirmPremiumCheckout, { sessionId: bad })) as {
        ok: boolean;
        reason?: string;
      };
      expect(res).toMatchObject({ ok: false, reason: "bad_session" });
    }
    expect(fetchCalls).toHaveLength(0);
  });

  it("reports unconfigured billing instead of failing open", async () => {
    const res = (await invoke(billing.confirmPremiumCheckout, { sessionId })) as {
      ok: boolean;
      reason?: string;
    };
    expect(res).toMatchObject({ ok: false, reason: "not_configured" });
    expect(fetchCalls).toHaveLength(0);
  });

  it("grants the period + badge from a paid, WIZZ-owned session", async () => {
    stripeOn();
    db.profiles = { data: freshProfile(), error: null };
    fetchRoutes = [
      { method: "GET", match: /\/v1\/checkout\/sessions\/cs_test_/, body: paidSession() },
    ];
    const res = (await invoke(billing.confirmPremiumCheckout, { sessionId })) as {
      ok: boolean;
      premiumUntil: string | null;
    };
    expect(res).toEqual({ ok: true, premiumUntil: PERIOD_ISO });
    const updates = callsTo("profiles", "update") as Record<string, unknown>[];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      premium_until: PERIOD_ISO,
      verified: true,
      premium_cancel_at_period_end: false,
      stripe_subscription_id: "sub_NEW",
      stripe_customer_id: "cus_SAME",
    });
    // The lookup expanded the subscription in one call.
    expect(fetchCall(0).url).toContain("expand[0]=subscription");
  });

  it("understands the newer item-level period shape", async () => {
    stripeOn();
    db.profiles = { data: freshProfile(), error: null };
    fetchRoutes = [
      {
        method: "GET",
        match: /\/v1\/checkout\/sessions\//,
        body: paidSession({
          subscription: {
            id: "sub_NEW",
            status: "trialing",
            customer: "cus_SAME",
            cancel_at_period_end: false,
            items: { data: [{ current_period_end: PERIOD_END }] },
          },
        }),
      },
    ];
    const res = (await invoke(billing.confirmPremiumCheckout, { sessionId })) as {
      ok: boolean;
      premiumUntil: string | null;
    };
    expect(res).toEqual({ ok: true, premiumUntil: PERIOD_ISO });
  });

  it("stays pending while Stripe reports it unpaid — no grant", async () => {
    stripeOn();
    db.profiles = { data: freshProfile(), error: null };
    fetchRoutes = [
      {
        method: "GET",
        match: /\/v1\/checkout\/sessions\//,
        body: paidSession({ payment_status: "unpaid" }),
      },
    ];
    const res = (await invoke(billing.confirmPremiumCheckout, { sessionId })) as {
      ok: boolean;
      reason?: string;
    };
    expect(res).toMatchObject({ ok: false, reason: "pending" });
    expect(callsTo("profiles", "update")).toHaveLength(0);
  });

  it("ignores a completed checkout that is not WIZZ Premium", async () => {
    stripeOn();
    db.profiles = { data: freshProfile(), error: null };
    fetchRoutes = [
      {
        method: "GET",
        match: /\/v1\/checkout\/sessions\//,
        body: paidSession({ metadata: { product: "wizz_tip" } }),
      },
    ];
    const res = (await invoke(billing.confirmPremiumCheckout, { sessionId })) as {
      ok: boolean;
      reason?: string;
    };
    expect(res).toMatchObject({ ok: false, reason: "not_wizz" });
    expect(callsTo("profiles", "update")).toHaveLength(0);
  });

  it("refuses when the session carries no account id", async () => {
    stripeOn();
    db.profiles = { data: freshProfile(), error: null };
    fetchRoutes = [
      {
        method: "GET",
        match: /\/v1\/checkout\/sessions\//,
        body: paidSession({ client_reference_id: "not-a-uuid" }),
      },
    ];
    const res = (await invoke(billing.confirmPremiumCheckout, { sessionId })) as {
      ok: boolean;
      reason?: string;
    };
    expect(res).toMatchObject({ ok: false, reason: "no_user" });
    expect(callsTo("profiles", "update")).toHaveLength(0);
  });

  it("reports pending when the subscription is not active yet", async () => {
    stripeOn();
    db.profiles = { data: freshProfile(), error: null };
    fetchRoutes = [
      {
        method: "GET",
        match: /\/v1\/checkout\/sessions\//,
        body: paidSession({
          subscription: { id: "sub_NEW", status: "incomplete", customer: "cus_SAME" },
        }),
      },
    ];
    const res = (await invoke(billing.confirmPremiumCheckout, { sessionId })) as {
      ok: boolean;
      reason?: string;
    };
    expect(res).toMatchObject({ ok: false, reason: "pending" });
    expect(callsTo("profiles", "update")).toHaveLength(0);
  });

  it("never breaks the return page — Stripe or DB failures report 'error'", async () => {
    stripeOn();
    db.profiles = { data: freshProfile(), error: null };
    fetchRoutes = [
      {
        method: "GET",
        match: /\/v1\/checkout\/sessions\//,
        status: 500,
        body: { error: { message: "boom" } },
      },
    ];
    expect(await invoke(billing.confirmPremiumCheckout, { sessionId })).toMatchObject({
      ok: false,
      reason: "error",
    });

    fetchRoutes = [{ method: "GET", match: /\/v1\/checkout\/sessions\//, body: paidSession() }];
    db.updateError = new Error("permission denied");
    expect(await invoke(billing.confirmPremiumCheckout, { sessionId })).toMatchObject({
      ok: false,
      reason: "error",
    });
  });
});
