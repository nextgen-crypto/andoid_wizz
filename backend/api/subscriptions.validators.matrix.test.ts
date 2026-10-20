import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Table-driven matrix for backend/api/subscriptions.functions.ts.
 *
 * Two layers:
 *  1. Pure helpers — premiumActiveAt / deriveVerificationStatus /
 *     nextPremiumUntil are clock-injected and pinned directly across the
 *     expiry/status/renewal matrix.
 *  2. Handlers — the Supabase service-role client is replaced by a scripted
 *     recorder (including state-mutating update/insert/delete chains) so the
 *     activate/cancel/request flows are driven end to end: write shapes,
 *     already-verified guards, and the `live: false` offline degradation.
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

// Auth middleware: injects a fixed account context, no HTTP, no Supabase.
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: {
    _server: async ({ next }: { next: (ctx?: unknown) => Promise<void> }) =>
      next({ context: { userId: "uid-TEST", claims: { sub: "uid-TEST" } } }),
  },
}));

// ---------------------------------------------------------------------------
// Scripted service-role client (state-mutating chains)
// ---------------------------------------------------------------------------

type DbCall = { table: string; op: string; payload?: unknown };

const db = {
  calls: [] as DbCall[],
  profiles: { data: null as Record<string, unknown> | null, error: null as unknown },
  requests: { data: null as Record<string, unknown> | null, error: null as unknown },
  updateError: null as unknown,
  deleteError: null as unknown,
  insertError: null as unknown,
};

function resetDb(): void {
  db.calls = [];
  db.profiles = { data: null, error: null };
  db.requests = { data: null, error: null };
  db.updateError = null;
  db.deleteError = null;
  db.insertError = null;
}

function callsTo(table: string, op: string): unknown[] {
  return db.calls.filter((c) => c.table === table && c.op === op).map((c) => c.payload);
}

/** Thenable + chainable `.eq()` — mirrors PostgREST builder semantics. */
function eqChain(op: string, apply: () => void) {
  const chain = {
    eq: () => chain,
    then: (onF?: (v: { error: unknown }) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve({ error: op === "update" ? db.updateError : db.deleteError })
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
      // Chainable filters — handlers stack multiple `.eq()` calls.
      const chain = {
        eq: () => chain,
        maybeSingle: async () => (table === "profiles" ? db.profiles : db.requests),
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
      return eqChain("delete", () => {
        if (table === "verification_requests") db.requests.data = null;
      });
    },
    insert: (payload: unknown) => {
      db.calls.push({ table, op: "insert", payload });
      return {
        then: (onF?: (v: { error: unknown }) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve({ error: db.insertError })
            .then((res) => {
              if (res.error == null && table === "verification_requests") {
                db.requests.data = { id: "req-1" };
              }
              return res;
            })
            .then(onF, onR),
      };
    },
  }),
};

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

const subs = await import("./subscriptions.functions");

type Callable = ((opts?: { data?: unknown }) => Promise<unknown>) & {
  _validator?: (data: unknown) => unknown;
};

function validatorOf(fn: unknown): (data: unknown) => Record<string, unknown> {
  return (fn as Callable)._validator as unknown as (data: unknown) => Record<string, unknown>;
}

function invoke(fn: unknown, data?: unknown): Promise<unknown> {
  return (fn as Callable)({ data });
}

beforeEach(() => resetDb());

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("premiumActiveAt", () => {
  const now = new Date("2026-10-20T12:00:00.000Z");
  const rows: Array<[label: string, input: string | null | undefined, expected: boolean]> = [
    ["null", null, false],
    ["undefined", undefined, false],
    ["empty string", "", false],
    ["past expiry", "2026-10-19T11:59:59.000Z", false],
    ["exactly now", now.toISOString(), false],
    ["one ms future", "2026-10-20T12:00:00.001Z", true],
    ["far future", "2027-01-01T00:00:00.000Z", true],
    ["unparseable", "not-a-date", false],
    ["numeric garbage", "NaN", false],
  ];

  it.each(rows)("%s → %s", (_label, input, expected) => {
    expect(subs.premiumActiveAt(input, now)).toBe(expected);
  });
});

describe("deriveVerificationStatus", () => {
  const rows: Array<[label: string, verified: boolean, pending: boolean, expected: string]> = [
    ["verified, no request", true, false, "verified"],
    ["verified, request still queued", true, true, "verified"],
    ["not verified, queued", false, true, "pending"],
    ["not verified, nothing queued", false, false, "none"],
  ];

  it.each(rows)("%s", (_label, verified, pending, expected) => {
    expect(subs.deriveVerificationStatus(verified, pending)).toBe(expected);
  });
});

describe("nextPremiumUntil", () => {
  const now = new Date("2026-10-20T12:00:00.000Z");
  const DAY = 86_400_000;

  it("starts a fresh period 30 days from now when there is no current period", () => {
    expect(subs.nextPremiumUntil(null, now)).toBe("2026-11-19T12:00:00.000Z");
  });

  it("ignores an expired current period and restarts from now", () => {
    expect(subs.nextPremiumUntil("2026-10-01T00:00:00.000Z", now)).toBe("2026-11-19T12:00:00.000Z");
  });

  it("extends a still-active period instead of shortening it", () => {
    const current = "2026-11-05T00:00:00.000Z";
    const next = subs.nextPremiumUntil(current, now);
    expect(Date.parse(next) - Date.parse(current)).toBe(30 * DAY);
    expect(Date.parse(next)).toBeGreaterThan(now.getTime() + 30 * DAY - DAY);
  });

  it("honours a custom period length", () => {
    expect(subs.nextPremiumUntil(null, now, 7)).toBe("2026-10-27T12:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

describe("requestVerification validator", () => {
  const validate = validatorOf(subs.requestVerification);

  it("defaults a missing note to empty", () => {
    expect(validate(undefined)["note"]).toBe("");
    expect(validate({})["note"]).toBe("");
    expect(validate({ note: null })["note"]).toBe("");
  });

  it("passes a short note through", () => {
    expect(validate({ note: "I'm a news outlet" })["note"]).toBe("I'm a news outlet");
  });

  it("caps long notes at 300 characters", () => {
    const note = validate({ note: "x".repeat(400) })["note"] as string;
    expect(note).toHaveLength(300);
  });

  it("does not coerce non-string notes", () => {
    expect(validate({ note: 42 })["note"]).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

type StateResult = {
  premiumUntil: string | null;
  premiumActive: boolean;
  verified: boolean;
  verificationStatus: string;
  live: boolean;
};

describe("fetchMySubscription", () => {
  it("reports active premium + verified with a queued request", async () => {
    db.profiles = {
      data: { verified: true, premium_until: "2026-11-19T12:00:00.000Z" },
      error: null,
    };
    db.requests = { data: { id: "req-1" }, error: null };
    const res = (await invoke(subs.fetchMySubscription)) as StateResult;
    expect(res).toMatchObject({
      premiumActive: true,
      verified: true,
      verificationStatus: "verified",
      live: true,
    });
    expect(Date.parse(res.premiumUntil!)).toBeGreaterThan(Date.parse("2026-11-01"));
  });

  it("reports expired premium as inactive while staying live", async () => {
    db.profiles = {
      data: { verified: false, premium_until: "2026-10-01T00:00:00.000Z" },
      error: null,
    };
    db.requests = { data: null, error: null };
    const res = (await invoke(subs.fetchMySubscription)) as StateResult;
    expect(res).toMatchObject({ premiumActive: false, live: true });
  });

  it("reports a pending verification queue for an unverified member", async () => {
    db.profiles = { data: { verified: false, premium_until: null }, error: null };
    db.requests = { data: { id: "req-9" }, error: null };
    const res = (await invoke(subs.fetchMySubscription)) as StateResult;
    expect(res).toMatchObject({ verificationStatus: "pending", live: true });
  });

  it("degrades to live:false when the schema is missing", async () => {
    db.profiles = { data: null, error: new Error("column profiles.premium_until does not exist") };
    db.requests = { data: null, error: null };
    const res = (await invoke(subs.fetchMySubscription)) as StateResult;
    expect(res.live).toBe(false);
    expect(res.premiumActive).toBe(false);
    expect(res.verificationStatus).toBe("none");
  });
});

describe("activatePremium", () => {
  it("writes a 30-day expiry and returns the activated state", async () => {
    db.profiles = { data: { verified: false, premium_until: null }, error: null };
    db.requests = { data: null, error: null };
    const res = (await invoke(subs.activatePremium)) as StateResult;
    const writes = callsTo("profiles", "update") as { premium_until: string }[];
    expect(writes).toHaveLength(1);
    const premiumUntil = writes[0]?.premium_until ?? "";
    expect(premiumUntil).not.toBe("");
    const delta = Date.parse(premiumUntil) - Date.now();
    expect(delta).toBeGreaterThan(30 * 86_400_000 - 5_000);
    expect(delta).toBeLessThan(30 * 86_400_000 + 5_000);
    expect(res).toMatchObject({ premiumActive: true, live: true });
  });

  it("extends an active period from its current expiry", async () => {
    db.profiles = {
      data: { verified: false, premium_until: "2026-11-19T12:00:00.000Z" },
      error: null,
    };
    db.requests = { data: null, error: null };
    await invoke(subs.activatePremium);
    const writes = callsTo("profiles", "update") as { premium_until: string }[];
    expect(writes[0]?.premium_until).toBe("2026-12-19T12:00:00.000Z");
  });

  it("does not pretend to subscribe when the write fails", async () => {
    db.profiles = { data: { verified: false, premium_until: null }, error: null };
    db.requests = { data: null, error: null };
    db.updateError = new Error("relation does not exist");
    const res = (await invoke(subs.activatePremium)) as StateResult;
    // The write was rejected, so the state read still reports the truth:
    // no premium — even though the read path itself is healthy.
    expect(res.premiumActive).toBe(false);
    expect(res.premiumUntil).toBeNull();
  });
});

describe("cancelPremium", () => {
  it("clears premium_until and returns the inactive state", async () => {
    db.profiles = {
      data: { verified: false, premium_until: "2026-11-19T12:00:00.000Z" },
      error: null,
    };
    db.requests = { data: null, error: null };
    const res = (await invoke(subs.cancelPremium)) as StateResult;
    expect(callsTo("profiles", "update")).toEqual([{ premium_until: null }]);
    expect(res).toMatchObject({ premiumUntil: null, premiumActive: false, live: true });
  });
});

describe("requestVerification", () => {
  it("files a pending request (clears any stale one first)", async () => {
    db.profiles = { data: { verified: false, premium_until: null }, error: null };
    db.requests = { data: null, error: null };
    const res = (await invoke(subs.requestVerification, { note: "News org" })) as StateResult;
    expect(callsTo("verification_requests", "delete")).toHaveLength(1);
    expect(callsTo("verification_requests", "insert")).toEqual([
      { user_id: "uid-TEST", status: "pending", reviewer_note: "News org" },
    ]);
    expect(res).toMatchObject({ verificationStatus: "pending", live: true });
  });

  it("never files a request for an already-verified account", async () => {
    db.profiles = { data: { verified: true, premium_until: null }, error: null };
    db.requests = { data: null, error: null };
    const res = (await invoke(subs.requestVerification)) as StateResult;
    expect(callsTo("verification_requests", "insert")).toHaveLength(0);
    expect(callsTo("verification_requests", "delete")).toHaveLength(0);
    expect(res).toMatchObject({ verified: true, verificationStatus: "verified" });
  });

  it("still returns state when the queue table is missing", async () => {
    db.profiles = { data: { verified: false, premium_until: null }, error: null };
    db.requests = { data: null, error: null };
    db.insertError = new Error("relation verification_requests does not exist");
    const res = (await invoke(subs.requestVerification)) as StateResult;
    expect(res).toMatchObject({ verificationStatus: "none", live: true });
  });
});
