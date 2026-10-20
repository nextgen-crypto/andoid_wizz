import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Table-driven matrix for backend/api/admin.functions.ts.
 *
 * Two layers:
 *  1. Validators — every exported server function registers its validator on
 *     the createServerFn builder; the harness below exposes it as `_validator`
 *     so each normalization rule is pinned directly (defaults, trims, caps,
 *     clamps, passthroughs).
 *  2. Handlers — the Supabase service-role client is replaced by a scripted
 *     chain recorder, `requireAdmin` is mocked, and every write/read branch is
 *     driven by hardcoded expectations (patch shapes, detail fallbacks, error
 *     propagation, graceful `live: false` degradation).
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

// Auth middleware: injects a fixed admin context, no HTTP, no Supabase.
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: {
    _server: async ({ next }: { next: (ctx?: unknown) => Promise<void> }) =>
      next({ context: { userId: "uid-ADMIN", claims: { sub: "uid-ADMIN" } } }),
  },
}));

// Admin gate: fully controlled per test.
const requireAdminMock = vi.fn(async (): Promise<void> => undefined);
const checkIsAdminMock = vi.fn(async (): Promise<boolean> => true);
vi.mock("./admin-auth", () => ({
  requireAdmin: requireAdminMock,
  checkIsAdmin: checkIsAdminMock,
}));

// ---------------------------------------------------------------------------
// Scripted service-role client
// ---------------------------------------------------------------------------

type DbCall = { table: string; op: string; payload?: unknown };

const db = {
  calls: [] as DbCall[],
  maybeSingle: new Map<string, { data: unknown; error: unknown }>(),
  listed: new Map<string, { data: unknown; error: unknown }>(),
  inRows: new Map<string, unknown>(),
  updateError: null as unknown,
  insertError: null as unknown,
  deleteError: null as unknown,
  upsertError: null as unknown,
  inserted: { id: "inserted-row-id" } as unknown,
  users: [] as { id: string; email?: string | null }[],
};

function resetDb(): void {
  db.calls = [];
  db.maybeSingle.clear();
  db.listed.clear();
  db.inRows.clear();
  db.updateError = null;
  db.insertError = null;
  db.deleteError = null;
  db.upsertError = null;
  db.inserted = { id: "inserted-row-id" };
  db.users = [];
}

function callsTo(table: string, op: string): unknown[] {
  return db.calls.filter((c) => c.table === table && c.op === op).map((c) => c.payload);
}

const supabaseAdmin = {
  from: (table: string) => ({
    select: (...args: unknown[]) => {
      db.calls.push({ table, op: "select", payload: args });
      return {
        eq: (...eqArgs: unknown[]) => ({
          maybeSingle: async () => db.maybeSingle.get(table) ?? { data: null, error: null },
          single: async () => db.maybeSingle.get(table) ?? { data: null, error: null },
          _eq: eqArgs,
        }),
        order: () => ({
          limit: async () => db.listed.get(table) ?? { data: null, error: null },
        }),
        in: async (...inArgs: unknown[]) => {
          db.calls.push({ table, op: "in", payload: inArgs });
          return { data: db.inRows.get(table) ?? null };
        },
      };
    },
    update: (payload: unknown) => {
      db.calls.push({ table, op: "update", payload });
      // Thenable + chainable — PostgREST builders stack `.eq()` filters.
      const chain = {
        eq: () => chain,
        then: (onF?: (v: { error: unknown }) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve({ error: db.updateError }).then(onF, onR),
      };
      return chain;
    },
    insert: (payload: unknown) => {
      db.calls.push({ table, op: "insert", payload });
      return {
        error: db.insertError,
        select: () => ({ single: async () => ({ data: db.inserted, error: db.insertError }) }),
      };
    },
    delete: () => {
      db.calls.push({ table, op: "delete" });
      return { eq: async () => ({ error: db.deleteError }) };
    },
    upsert: async (payload: unknown, opts?: unknown) => {
      db.calls.push({ table, op: "upsert", payload: { payload, opts } });
      return { error: db.upsertError };
    },
  }),
  auth: {
    admin: {
      listUsers: async ({ page }: { page: number }) => {
        db.calls.push({ table: "auth", op: "listUsers", payload: page });
        if (page === 1) return { data: { users: db.users.slice(0, 100) }, error: null };
        return { data: { users: db.users.slice(100) }, error: null };
      },
    },
  },
};

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

const adminFns = await import("./admin.functions");

type Callable = ((opts?: { data?: unknown }) => Promise<unknown>) & {
  _validator?: (data: unknown) => unknown;
};

function validatorOf(fn: unknown): (data: unknown) => Record<string, unknown> {
  return (fn as Callable)._validator as unknown as (data: unknown) => Record<string, unknown>;
}

function invoke(fn: unknown, data?: unknown): Promise<unknown> {
  return (fn as Callable)({ data });
}

beforeEach(() => {
  resetDb();
  requireAdminMock.mockClear();
  requireAdminMock.mockResolvedValue(undefined);
  checkIsAdminMock.mockClear();
  checkIsAdminMock.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

describe("resolveAdminReport validator", () => {
  const validate = validatorOf(adminFns.resolveAdminReport);

  const idRows: Array<[label: string, input: unknown, expected: unknown]> = [
    ["undefined defaults to empty", undefined, ""],
    [
      "a uuid passes through",
      "11111111-1111-1111-1111-111111111111",
      "11111111-1111-1111-1111-111111111111",
    ],
    ["a non-uuid string passes through (handler rejects it)", "not-a-uuid", "not-a-uuid"],
    ["a number is not coerced", 42, 42],
  ];

  it.each(idRows)("id: %s", (_label, input, expected) => {
    expect(validate({ id: input })["id"]).toBe(expected);
  });

  // `data?.id ?? ""` only defaults on nullish values — a non-nullish
  // non-string survives the validator untouched (the handler then fails
  // isUuid on it), while a payload with no `id` key defaults to empty.
  it("id: an object does not default (?? only guards nullish)", () => {
    const obj = {};
    expect(validate({ id: obj })["id"]).toBe(obj);
  });

  it("a payload without an id field at all defaults to empty", () => {
    expect(validate({})["id"]).toBe("");
    expect(validate(undefined)?.["id"]).toBe("");
  });

  const actionRows: Array<[label: string, input: unknown, expected: string]> = [
    ["undefined defaults to approve", undefined, "approve"],
    ["approve passes through", "approve", "approve"],
    ["remove_content passes through", "remove_content", "remove_content"],
    ["delete_content passes through", "delete_content", "delete_content"],
    ["warn passes through", "warn", "warn"],
    ["restrict passes through", "restrict", "restrict"],
    ["suspend passes through", "suspend", "suspend"],
    ["unsuspend passes through", "unsuspend", "unsuspend"],
    ["an unknown action passes validation (handler has no action guard)", "bogus", "bogus"],
  ];

  it.each(actionRows)("action: %s", (_label, input, expected) => {
    expect(validate({ action: input })["action"]).toBe(expected);
  });

  const noteRows: Array<[label: string, input: unknown, expected: unknown]> = [
    ["undefined becomes empty", undefined, ""],
    ["null becomes empty", null, ""],
    ["an empty note stays empty", "", ""],
    ["a short note passes through", "looks fine", "looks fine"],
    ["exactly 300 chars pass through", "n".repeat(300), "n".repeat(300)],
    ["301 chars are sliced to 300", "n".repeat(301), "n".repeat(300)],
    ["1000 chars are sliced to 300", "n".repeat(1000), "n".repeat(300)],
  ];

  it.each(noteRows)("note: %s", (_label, input, expected) => {
    expect(validate({ note: input })["note"]).toBe(expected);
  });

  it("defaults the whole payload at once", () => {
    expect(validate(undefined)).toEqual({ id: "", action: "approve", note: "" });
    expect(validate({})).toEqual({ id: "", action: "approve", note: "" });
  });

  it("a number note throws (the ?? only guards nullish values)", () => {
    expect(() => validate({ note: 5 })).toThrow(TypeError);
  });
});

describe("sendUserWarning validator", () => {
  const validate = validatorOf(adminFns.sendUserWarning);

  const userIdRows: Array<[input: unknown, expected: unknown]> = [
    [undefined, ""],
    ["22222222-2222-2222-2222-222222222222", "22222222-2222-2222-2222-222222222222"],
    [null, ""],
  ];

  it.each(userIdRows)("userId %j -> %j", (input, expected) => {
    expect(validate({ userId: input })["userId"]).toBe(expected);
  });

  const messageRows: Array<[label: string, input: unknown, expected: unknown]> = [
    ["undefined becomes empty", undefined, ""],
    ["a message passes through", "Do not spam.", "Do not spam."],
    ["exactly 300 chars pass through", "m".repeat(300), "m".repeat(300)],
    ["301 chars are sliced to 300", "m".repeat(301), "m".repeat(300)],
  ];

  it.each(messageRows)("message: %s", (_label, input, expected) => {
    expect(validate({ message: input })["message"]).toBe(expected);
  });

  it("defaults the whole payload at once", () => {
    expect(validate(undefined)).toEqual({ userId: "", message: "" });
  });
});

describe("reviewAdminCampaign validator", () => {
  const validate = validatorOf(adminFns.reviewAdminCampaign);

  const actionRows: Array<[label: string, input: unknown, expected: string]> = [
    ["undefined defaults to approve", undefined, "approve"],
    ["approve passes through", "approve", "approve"],
    ["reject passes through", "reject", "reject"],
    ["pause passes through", "pause", "pause"],
    ["resume passes through", "resume", "resume"],
    ["complete passes through", "complete", "complete"],
    ["an unknown action passes validation (handler rejects it)", "delete", "delete"],
  ];

  it.each(actionRows)("action: %s", (_label, input, expected) => {
    expect(validate({ action: input })["action"]).toBe(expected);
  });

  const noteRows: Array<[label: string, input: unknown, expected: unknown]> = [
    ["undefined becomes empty", undefined, ""],
    ["a note passes through", "spam campaign", "spam campaign"],
    ["301 chars are sliced to 300", "c".repeat(301), "c".repeat(300)],
  ];

  it.each(noteRows)("note: %s", (_label, input, expected) => {
    expect(validate({ note: input })["note"]).toBe(expected);
  });

  it("defaults the whole payload at once", () => {
    expect(validate(undefined)).toEqual({ id: "", action: "approve", note: "" });
  });

  const idRows: Array<[input: unknown, expected: unknown]> = [
    [undefined, ""],
    ["33333333-3333-3333-3333-333333333333", "33333333-3333-3333-3333-333333333333"],
  ];

  it.each(idRows)("id %j -> %j", (input, expected) => {
    expect(validate({ id: input })["id"]).toBe(expected);
  });
});

describe("adminSaveNewsStory validator", () => {
  const validate = validatorOf(adminFns.adminSaveNewsStory);

  const headlineRows: Array<[label: string, input: unknown, expected: unknown]> = [
    ["undefined becomes empty", undefined, ""],
    ["padded input is trimmed", "  Headline  ", "Headline"],
    ["exactly 200 chars pass through", "h".repeat(200), "h".repeat(200)],
    ["201 chars are sliced to 200", "h".repeat(201), "h".repeat(200)],
    ["300 padded chars trim then slice", ` ${"h".repeat(250)} `, "h".repeat(200)],
  ];

  it.each(headlineRows)("headline: %s", (_label, input, expected) => {
    expect(validate({ headline: input })["headline"]).toBe(expected);
  });

  const summaryRows: Array<[label: string, input: unknown, expected: unknown]> = [
    ["undefined becomes empty", undefined, ""],
    ["a summary is trimmed", "  Body  ", "Body"],
    ["exactly 2000 chars pass through", "s".repeat(2000), "s".repeat(2000)],
    ["2001 chars are sliced to 2000", "s".repeat(2001), "s".repeat(2000)],
  ];

  it.each(summaryRows)("summary: %s", (_label, input, expected) => {
    expect(validate({ summary: input })["summary"]).toBe(expected);
  });

  const categoryRows: Array<[input: unknown, expected: unknown]> = [
    [undefined, "General"],
    ["", ""],
    ["  Science  ", "Science"],
    ["c".repeat(41), "c".repeat(40)],
  ];

  it.each(categoryRows)("category %j -> %j", (input, expected) => {
    expect(validate({ category: input })["category"]).toBe(expected);
  });

  const stateRows: Array<[input: unknown, expected: unknown]> = [
    [undefined, "developing"],
    ["breaking", "breaking"],
    ["", ""],
    ["s".repeat(21), "s".repeat(20)],
  ];

  it.each(stateRows)("state %j -> %j", (input, expected) => {
    expect(validate({ state: input })["state"]).toBe(expected);
  });

  it("defaults the whole payload at once", () => {
    expect(validate(undefined)).toEqual({
      id: "",
      headline: "",
      summary: "",
      category: "General",
      state: "developing",
    });
  });

  it("an id passes through unvalidated (handler checks the uuid)", () => {
    expect(validate({ id: "bogus" })["id"]).toBe("bogus");
  });
});

describe("id-only validators", () => {
  const rows: Array<[label: string, fn: unknown]> = [
    ["adminDeleteNewsStory", adminFns.adminDeleteNewsStory],
    ["adminDeleteTrendingTopic", adminFns.adminDeleteTrendingTopic],
  ];

  it.each(rows)("%s defaults a missing id to empty", (_label, fn) => {
    expect(validatorOf(fn)(undefined)).toEqual({ id: "" });
    expect(validatorOf(fn)({})).toEqual({ id: "" });
  });

  it.each(rows)("%s passes an id through untouched", (_label, fn) => {
    const id = "44444444-4444-4444-4444-444444444444";
    expect(validatorOf(fn)({ id })).toEqual({ id });
  });

  const revokeOnly: Array<[label: string, fn: unknown, key: string]> = [
    ["revokeAdminRole", adminFns.revokeAdminRole, "userId"],
  ];

  it.each(revokeOnly)("%s keys the field %s", (_label, fn, key) => {
    const result = validatorOf(fn)({ [key]: "55555555-5555-5555-5555-555555555555" }) as Record<
      string,
      unknown
    >;
    expect(result["userId"]).toBe("55555555-5555-5555-5555-555555555555");
  });

  it("revokeAdminRole defaults a missing userId to empty", () => {
    expect(validatorOf(adminFns.revokeAdminRole)(undefined)).toEqual({ userId: "" });
    expect(validatorOf(adminFns.revokeAdminRole)({})).toEqual({ userId: "" });
  });

  it("revokeAdminRole ignores an `id` field entirely", () => {
    expect(
      validatorOf(adminFns.revokeAdminRole)({ id: "66666666-6666-6666-6666-666666666666" }),
    ).toEqual({
      userId: "",
    });
  });
});

describe("adminCreateTrendingTopic validator", () => {
  const validate = validatorOf(adminFns.adminCreateTrendingTopic);

  const labelRows: Array<[label: string, input: unknown, expected: unknown]> = [
    ["undefined becomes empty", undefined, ""],
    ["padding is trimmed", "  WIZZ  ", "WIZZ"],
    ["exactly 80 chars pass through", "l".repeat(80), "l".repeat(80)],
    ["81 chars are sliced to 80", "l".repeat(81), "l".repeat(80)],
  ];

  it.each(labelRows)("label: %s", (_label, input, expected) => {
    expect(validate({ label: input })["label"]).toBe(expected);
  });

  const contextRows: Array<[label: string, input: unknown, expected: unknown]> = [
    ["undefined becomes empty", undefined, ""],
    ["padding is trimmed", "  ctx  ", "ctx"],
    ["exactly 120 chars pass through", "x".repeat(120), "x".repeat(120)],
    ["121 chars are sliced to 120", "x".repeat(121), "x".repeat(120)],
  ];

  it.each(contextRows)("context: %s", (_label, input, expected) => {
    expect(validate({ context: input })["context"]).toBe(expected);
  });

  const countRows: Array<[label: string, input: unknown, expected: number]> = [
    ["undefined floors to 0", undefined, 0],
    ["3 floors to 3", 3, 3],
    ["3.9 floors to 3", 3.9, 3],
    ["-5 clamps to 0", -5, 0],
    ["-0.5 floors to -0 then clamps to 0", -0.5, 0],
    ["0 stays 0", 0, 0],
    ["1_000_000 stays at the cap", 1_000_000, 1_000_000],
    ["1_000_001 clamps to the cap", 1_000_001, 1_000_000],
    ["999_999_999 clamps to the cap", 999_999_999, 1_000_000],
  ];

  it.each(countRows)("postCount: %s", (_label, input, expected) => {
    expect(validate({ postCount: input })["postCount"]).toBe(expected);
  });

  it("defaults the whole payload at once", () => {
    expect(validate(undefined)).toEqual({ label: "", context: "", postCount: 0 });
  });
});

describe("grantAdminRole validator", () => {
  const validate = validatorOf(adminFns.grantAdminRole);

  const emailRows: Array<[label: string, input: unknown, expected: unknown]> = [
    ["undefined becomes empty", undefined, ""],
    ["an address is lowercased", "Admin@Example.COM", "admin@example.com"],
    ["padding is trimmed", "  a@b.co  ", "a@b.co"],
    ["an already-normalized address passes through", "a@b.co", "a@b.co"],
    ["exactly 120 chars pass through", `${"a".repeat(108)}@x.co`, `${"a".repeat(108)}@x.co`],
    [
      "over 120 chars are sliced (handler rejects the truncated address)",
      `${"a".repeat(200)}@x.co`,
      `${"a".repeat(120)}`,
    ],
  ];

  it.each(emailRows)("email: %s", (_label, input, expected) => {
    expect(validate({ email: input })["email"]).toBe(expected);
  });

  it("defaults the whole payload at once", () => {
    expect(validate(undefined)).toEqual({ email: "" });
  });
});

// ---------------------------------------------------------------------------
// fetchAdminIdentity
// ---------------------------------------------------------------------------

describe("fetchAdminIdentity", () => {
  it("mirrors checkIsAdmin exactly", async () => {
    for (const answer of [true, false]) {
      checkIsAdminMock.mockResolvedValueOnce(answer);
      await expect(invoke(adminFns.fetchAdminIdentity)).resolves.toEqual({ isAdmin: answer });
    }
    expect(checkIsAdminMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// fetchAdminReports
// ---------------------------------------------------------------------------

describe("fetchAdminReports", () => {
  it("joins reporter usernames onto each report", async () => {
    db.listed.set("reports", {
      data: [
        {
          id: "r1",
          kind: "post",
          reporter_id: "u1",
          target_user_id: null,
          ref_id: "",
          ref_title: "",
          reason: "",
          details: "",
          status: "open",
          resolution: "",
          created_at: "2026-01-01",
        },
        {
          id: "r2",
          kind: "comment",
          reporter_id: "u2",
          target_user_id: "t",
          ref_id: "",
          ref_title: "",
          reason: "",
          details: "",
          status: "open",
          resolution: "",
          created_at: "2026-01-02",
        },
      ],
      error: null,
    });
    db.inRows.set("profiles", [
      { id: "u1", username: "alice" },
      { id: "u2", username: "bob" },
    ]);
    const result = (await invoke(adminFns.fetchAdminReports)) as {
      live: boolean;
      reports: { id: string; reporter_name: string }[];
    };
    expect(result.live).toBe(true);
    expect(result.reports.map((r) => r.reporter_name)).toEqual(["alice", "bob"]);
  });

  it("uses '?' for a reporter with no profile row", async () => {
    db.listed.set("reports", {
      data: [
        {
          id: "r1",
          kind: "post",
          reporter_id: "ghost",
          target_user_id: null,
          ref_id: "",
          ref_title: "",
          reason: "",
          details: "",
          status: "open",
          resolution: "",
          created_at: "2026-01-01",
        },
      ],
      error: null,
    });
    db.inRows.set("profiles", []);
    const result = (await invoke(adminFns.fetchAdminReports)) as {
      reports: { reporter_name: string }[];
    };
    expect(result.reports[0]?.reporter_name).toBe("?");
  });

  it("skips the profile lookup when there are no reports", async () => {
    db.listed.set("reports", { data: [], error: null });
    const result = (await invoke(adminFns.fetchAdminReports)) as {
      live: boolean;
      reports: unknown[];
    };
    expect(result).toEqual({ live: true, reports: [] });
    expect(callsTo("profiles", "in")).toHaveLength(0);
  });

  it("degrades to live:false when the query errors", async () => {
    db.listed.set("reports", { data: null, error: { message: "boom" } });
    await expect(invoke(adminFns.fetchAdminReports)).resolves.toEqual({
      reports: [],
      live: false,
    });
  });

  it("refuses non-admins before touching the database", async () => {
    requireAdminMock.mockRejectedValue(new Error("Unauthorized: admin access required."));
    await expect(invoke(adminFns.fetchAdminReports)).rejects.toThrow("Unauthorized");
    expect(db.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// resolveAdminReport
// ---------------------------------------------------------------------------

describe("resolveAdminReport", () => {
  const UUID = "11111111-1111-1111-1111-111111111111";
  const POST_UUID = "99999999-9999-4999-8999-999999999999";
  const USER_UUID = "88888888-8888-4888-8888-888888888888";

  function seedReport(overrides: Record<string, unknown> = {}): void {
    db.maybeSingle.set("reports", {
      data: {
        kind: "post",
        ref_id: POST_UUID,
        ref_title: "Ref title",
        reason: "spam",
        target_user_id: USER_UUID,
        ...overrides,
      },
      error: null,
    });
  }

  it("rejects a non-uuid id with 'Report not found.'", async () => {
    await expect(
      invoke(adminFns.resolveAdminReport, { id: "nope", action: "approve" }),
    ).rejects.toThrow("Report not found.");
    expect(db.calls).toHaveLength(0);
  });

  it("rejects an empty id with 'Report not found.'", async () => {
    await expect(invoke(adminFns.resolveAdminReport, undefined)).rejects.toThrow(
      "Report not found.",
    );
  });

  it("rejects when the report row is missing", async () => {
    db.maybeSingle.set("reports", { data: null, error: null });
    await expect(invoke(adminFns.resolveAdminReport, { id: UUID })).rejects.toThrow(
      "Report not found.",
    );
  });

  it("rejects when the report query errors", async () => {
    db.maybeSingle.set("reports", { data: null, error: { message: "db down" } });
    await expect(invoke(adminFns.resolveAdminReport, { id: UUID })).rejects.toThrow(
      "Report not found.",
    );
  });

  const labelRows: Array<[action: string, expectedDetail: string]> = [
    ["approve", "Approved — no violation"],
    ["remove_content", "Content hidden"],
    ["delete_content", "Content deleted"],
    ["warn", "User warned"],
    ["restrict", "User restricted"],
    ["suspend", "User suspended"],
    ["unsuspend", "User unsuspended"],
  ];

  it.each(labelRows)("action %s uses its label when no note is given", async (action, expected) => {
    seedReport();
    const result = (await invoke(adminFns.resolveAdminReport, { id: UUID, action })) as {
      ok: boolean;
      detail: string;
    };
    expect(result).toEqual({ ok: true, detail: expected });
    expect(callsTo("reports", "update")).toEqual([{ status: "resolved", resolution: expected }]);
  });

  it("an explicit note overrides the label for every action", async () => {
    for (const [action] of labelRows) {
      resetDb();
      seedReport();
      const result = (await invoke(adminFns.resolveAdminReport, {
        id: UUID,
        action,
        note: "hand-written note",
      })) as { detail: string };
      expect(result.detail).toBe("hand-written note");
    }
  });

  // resolveAdminReport never validates `action` (only reviewAdminCampaign does
  // via CAMPAIGN_STATUS): an unknown action skips every branch and the label
  // lookup yields undefined, so the resolution written to the row is undefined
  // when no note is supplied.
  it("an unknown action is not rejected by resolveAdminReport", async () => {
    seedReport();
    const result = (await invoke(adminFns.resolveAdminReport, {
      id: UUID,
      action: "bogus",
    })) as { ok: boolean; detail: string | undefined };
    expect(result["ok"]).toBe(true);
    expect(result["detail"]).toBeUndefined();
  });

  it("an unknown action still writes resolution: undefined when no note is given", async () => {
    seedReport();
    await invoke(adminFns.resolveAdminReport, { id: UUID, action: "bogus" });
    expect(callsTo("reports", "update")).toEqual([{ status: "resolved", resolution: undefined }]);
  });

  it("an unknown action with a note resolves with that note", async () => {
    seedReport();
    const result = (await invoke(adminFns.resolveAdminReport, {
      id: UUID,
      action: "bogus",
      note: "custom resolution",
    })) as { detail: string | undefined };
    expect(result["detail"]).toBe("custom resolution");
    expect(callsTo("reports", "update")).toEqual([
      { status: "resolved", resolution: "custom resolution" },
    ]);
  });

  const contentRows: Array<[action: string, table: string, op: string, payload: unknown]> = [
    ["remove_content", "posts", "update", { status: "archived" }],
    ["delete_content", "posts", "delete", undefined],
    ["remove_content", "comments", "update", { is_deleted: true }],
    ["delete_content", "comments", "update", { is_deleted: true }],
  ];

  it.each(contentRows)("%s on a %s row performs %s", async (action, table, op, payload) => {
    seedReport({ kind: table === "posts" ? "post" : "comment" });
    await invoke(adminFns.resolveAdminReport, { id: UUID, action });
    const matching = db.calls.filter((c) => c.table === table && c.op === op);
    expect(matching).toHaveLength(1);
    if (op === "update") expect(matching[0]?.payload).toEqual(payload);
  });

  it("content actions on a non-uuid ref fall back to a local-hide detail", async () => {
    seedReport({ kind: "post", ref_id: "demo-slug" });
    const result = (await invoke(adminFns.resolveAdminReport, {
      id: UUID,
      action: "delete_content",
    })) as { detail: string };
    expect(result.detail).toBe("Demo content — hidden locally instead (not a database row)");
    expect(db.calls.filter((c) => c.table === "posts")).toHaveLength(0);
  });

  it("content actions on an unknown kind fall back to a local-hide detail", async () => {
    seedReport({ kind: "profile", ref_id: POST_UUID });
    const result = (await invoke(adminFns.resolveAdminReport, {
      id: UUID,
      action: "remove_content",
    })) as { detail: string };
    expect(result.detail).toBe("Demo content — hidden locally instead (not a database row)");
  });

  it("warn inserts an auto-generated message naming kind, title and reason", async () => {
    seedReport({ kind: "post", ref_title: "Cheap followers", reason: "spam" });
    await invoke(adminFns.resolveAdminReport, { id: UUID, action: "warn" });
    const inserts = callsTo("warnings", "insert") as { user_id: string; message: string }[];
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.user_id).toBe(USER_UUID);
    expect(inserts[0]?.message).toBe(
      'Your post "Cheap followers" was reported (spam). Please follow the community guidelines.',
    );
  });

  it("warn uses the note as the message when one is provided", async () => {
    seedReport();
    await invoke(adminFns.resolveAdminReport, { id: UUID, action: "warn", note: "cut it out" });
    const inserts = callsTo("warnings", "insert") as { message: string }[];
    expect(inserts[0]?.message).toBe("cut it out");
  });

  it("warn skips the insert when the target is not a real user id", async () => {
    seedReport({ target_user_id: null });
    await invoke(adminFns.resolveAdminReport, { id: UUID, action: "warn" });
    expect(callsTo("warnings", "insert")).toHaveLength(0);
  });

  const nonWarnRows = ["restrict", "suspend", "unsuspend", "approve"];

  it.each(nonWarnRows)("action %s never inserts a warning", async (action) => {
    seedReport();
    await invoke(adminFns.resolveAdminReport, { id: UUID, action });
    expect(callsTo("warnings", "insert")).toHaveLength(0);
  });

  it("always marks the report resolved last", async () => {
    seedReport();
    await invoke(adminFns.resolveAdminReport, { id: UUID, action: "approve" });
    expect(db.calls[db.calls.length - 1]).toEqual({
      table: "reports",
      op: "update",
      payload: { status: "resolved", resolution: "Approved — no violation" },
    });
  });

  it("propagates a report-update failure", async () => {
    seedReport();
    db.updateError = { message: "update failed" };
    await expect(invoke(adminFns.resolveAdminReport, { id: UUID })).rejects.toMatchObject({
      message: "update failed",
    });
  });

  it("propagates a content-delete failure", async () => {
    seedReport();
    db.deleteError = { message: "delete failed" };
    await expect(
      invoke(adminFns.resolveAdminReport, { id: UUID, action: "delete_content" }),
    ).rejects.toMatchObject({ message: "delete failed" });
  });

  it("refuses non-admins before touching the database", async () => {
    requireAdminMock.mockRejectedValue(new Error("Unauthorized: admin access required."));
    await expect(invoke(adminFns.resolveAdminReport, { id: UUID })).rejects.toThrow("Unauthorized");
    expect(db.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// sendUserWarning
// ---------------------------------------------------------------------------

describe("sendUserWarning", () => {
  const UUID = "77777777-7777-4777-8777-777777777777";

  const badIdRows: Array<[label: string, userId: unknown]> = [
    ["empty", ""],
    ["missing", undefined],
    ["not a uuid", "user-1"],
    ["a uuid-shaped non-hex string", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"],
  ];

  it.each(badIdRows)("rejects a %s userId", async (_label, userId) => {
    await expect(invoke(adminFns.sendUserWarning, { userId, message: "hello" })).rejects.toThrow(
      "Warnings need a real user account.",
    );
    expect(db.calls).toHaveLength(0);
  });

  const badMessageRows: Array<[label: string, message: unknown]> = [
    ["empty", ""],
    ["whitespace only", "   "],
    ["tabs only", "\t"],
  ];

  it.each(badMessageRows)("rejects a %s message", async (_label, message) => {
    await expect(invoke(adminFns.sendUserWarning, { userId: UUID, message })).rejects.toThrow(
      "Write the warning first.",
    );
    expect(db.calls).toHaveLength(0);
  });

  it("inserts the trimmed message for a valid request", async () => {
    await invoke(adminFns.sendUserWarning, { userId: UUID, message: "  Stop spamming.  " });
    expect(callsTo("warnings", "insert")).toEqual([{ user_id: UUID, message: "Stop spamming." }]);
  });

  it("propagates an insert failure", async () => {
    db.insertError = { message: "insert failed" };
    await expect(
      invoke(adminFns.sendUserWarning, { userId: UUID, message: "hi" }),
    ).rejects.toMatchObject({ message: "insert failed" });
  });

  it("refuses non-admins before touching the database", async () => {
    requireAdminMock.mockRejectedValue(new Error("Unauthorized: admin access required."));
    await expect(invoke(adminFns.sendUserWarning, { userId: UUID, message: "hi" })).rejects.toThrow(
      "Unauthorized",
    );
    expect(db.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// reviewAdminCampaign — the CAMPAIGN_STATUS mapping
// ---------------------------------------------------------------------------

describe("reviewAdminCampaign", () => {
  const UUID = "66666666-6666-4666-8666-666666666666";

  const statusRows: Array<[action: string, expectedPatch: unknown]> = [
    ["approve", { status: "active" }],
    ["pause", { status: "paused" }],
    ["resume", { status: "active" }],
    ["complete", { status: "completed" }],
  ];

  it.each(statusRows)("action %s patches status %j", async (action, expectedPatch) => {
    await invoke(adminFns.reviewAdminCampaign, { id: UUID, action });
    expect(callsTo("ad_campaigns", "update")).toEqual([expectedPatch]);
  });

  it("reject also stamps the rejection reason from the note", async () => {
    await invoke(adminFns.reviewAdminCampaign, {
      id: UUID,
      action: "reject",
      note: "misleading claims",
    });
    expect(callsTo("ad_campaigns", "update")).toEqual([
      { status: "rejected", rejection_reason: "misleading claims" },
    ]);
  });

  it("reject without a note stores an empty rejection reason", async () => {
    await invoke(adminFns.reviewAdminCampaign, { id: UUID, action: "reject" });
    expect(callsTo("ad_campaigns", "update")).toEqual([
      { status: "rejected", rejection_reason: "" },
    ]);
  });

  it("approve and resume both land on active", async () => {
    for (const action of ["approve", "resume"]) {
      resetDb();
      await invoke(adminFns.reviewAdminCampaign, { id: UUID, action });
      expect(callsTo("ad_campaigns", "update")).toEqual([{ status: "active" }]);
    }
  });

  const badIdRows: Array<[label: string, id: unknown]> = [
    ["empty", ""],
    ["missing", undefined],
    ["not a uuid", "campaign-1"],
  ];

  it.each(badIdRows)("rejects a %s id", async (_label, id) => {
    await expect(invoke(adminFns.reviewAdminCampaign, { id, action: "approve" })).rejects.toThrow(
      "Campaign not found.",
    );
    expect(db.calls).toHaveLength(0);
  });

  it("rejects an unknown action with 'Bad action.'", async () => {
    await expect(
      invoke(adminFns.reviewAdminCampaign, { id: UUID, action: "delete" }),
    ).rejects.toThrow("Bad action.");
    expect(callsTo("ad_campaigns", "update")).toHaveLength(0);
  });

  it("propagates an update failure", async () => {
    db.updateError = { message: "update failed" };
    await expect(
      invoke(adminFns.reviewAdminCampaign, { id: UUID, action: "pause" }),
    ).rejects.toMatchObject({ message: "update failed" });
  });

  it("refuses non-admins before touching the database", async () => {
    requireAdminMock.mockRejectedValue(new Error("Unauthorized: admin access required."));
    await expect(
      invoke(adminFns.reviewAdminCampaign, { id: UUID, action: "approve" }),
    ).rejects.toThrow("Unauthorized");
    expect(db.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// adminSaveNewsStory / adminDeleteNewsStory
// ---------------------------------------------------------------------------

describe("adminSaveNewsStory", () => {
  const UUID = "55555555-5555-4555-8555-555555555555";

  it("requires a headline", async () => {
    await expect(invoke(adminFns.adminSaveNewsStory, { headline: "" })).rejects.toThrow(
      "Headline is required.",
    );
    expect(db.calls).toHaveLength(0);
  });

  it("rejects a whitespace-only headline", async () => {
    await expect(invoke(adminFns.adminSaveNewsStory, { headline: "   " })).rejects.toThrow(
      "Headline is required.",
    );
  });

  it("rejects a non-uuid id with 'Story not found.'", async () => {
    await expect(
      invoke(adminFns.adminSaveNewsStory, { id: "bogus", headline: "H" }),
    ).rejects.toThrow("Story not found.");
  });

  it("updates an existing story and stamps updated_at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T07:08:09.010Z"));
    const result = await invoke(adminFns.adminSaveNewsStory, {
      id: UUID,
      headline: "H",
      summary: "S",
      category: "Science",
      state: "breaking",
    });
    expect(result).toEqual({ ok: true, id: UUID });
    expect(callsTo("news_stories", "update")).toEqual([
      {
        headline: "H",
        summary: "S",
        category: "Science",
        state: "breaking",
        updated_at: "2026-05-06T07:08:09.010Z",
      },
    ]);
    vi.useRealTimers();
  });

  it("inserts a new story when no id is given and returns the row id", async () => {
    db.inserted = { id: "fresh-id" };
    const result = await invoke(adminFns.adminSaveNewsStory, { headline: "H" });
    expect(result).toEqual({ ok: true, id: "fresh-id" });
    expect(callsTo("news_stories", "insert")).toEqual([
      { headline: "H", summary: "", category: "General", state: "developing" },
    ]);
  });

  it("propagates an insert failure", async () => {
    db.insertError = { message: "insert failed" };
    await expect(invoke(adminFns.adminSaveNewsStory, { headline: "H" })).rejects.toMatchObject({
      message: "insert failed",
    });
  });

  it("refuses non-admins before touching the database", async () => {
    requireAdminMock.mockRejectedValue(new Error("Unauthorized: admin access required."));
    await expect(invoke(adminFns.adminSaveNewsStory, { headline: "H" })).rejects.toThrow(
      "Unauthorized",
    );
    expect(db.calls).toHaveLength(0);
  });
});

describe("adminDeleteNewsStory", () => {
  const UUID = "44444444-4444-4444-8444-444444444444";

  const badIdRows: Array<[label: string, id: unknown]> = [
    ["empty", ""],
    ["missing", undefined],
    ["not a uuid", "story-1"],
  ];

  it.each(badIdRows)("rejects a %s id", async (_label, id) => {
    await expect(invoke(adminFns.adminDeleteNewsStory, { id })).rejects.toThrow("Story not found.");
    expect(db.calls).toHaveLength(0);
  });

  it("deletes a valid story id", async () => {
    await expect(invoke(adminFns.adminDeleteNewsStory, { id: UUID })).resolves.toEqual({
      ok: true,
    });
    expect(db.calls).toEqual([{ table: "news_stories", op: "delete" }]);
  });

  it("propagates a delete failure", async () => {
    db.deleteError = { message: "delete failed" };
    await expect(invoke(adminFns.adminDeleteNewsStory, { id: UUID })).rejects.toMatchObject({
      message: "delete failed",
    });
  });
});

// ---------------------------------------------------------------------------
// adminCreateTrendingTopic / adminDeleteTrendingTopic
// ---------------------------------------------------------------------------

describe("adminCreateTrendingTopic", () => {
  it("requires a label", async () => {
    await expect(invoke(adminFns.adminCreateTrendingTopic, { label: "" })).rejects.toThrow(
      "Topic label is required.",
    );
    expect(db.calls).toHaveLength(0);
  });

  it("ranks the new topic one above the current maximum", async () => {
    db.listed.set("trending_topics", { data: [{ rank: 41 }], error: null });
    await invoke(adminFns.adminCreateTrendingTopic, {
      label: "WIZZ",
      context: "launch",
      postCount: 12,
    });
    expect(callsTo("trending_topics", "insert")).toEqual([
      { label: "WIZZ", context: "launch", post_count: 12, rank: 42 },
    ]);
  });

  it("ranks from 1 when the table is empty", async () => {
    db.listed.set("trending_topics", { data: [], error: null });
    await invoke(adminFns.adminCreateTrendingTopic, { label: "First" });
    expect(callsTo("trending_topics", "insert")).toEqual([
      { label: "First", context: "", post_count: 0, rank: 1 },
    ]);
  });

  it("ranks from 1 when the rank query returns no rows", async () => {
    db.listed.set("trending_topics", { data: null, error: null });
    await invoke(adminFns.adminCreateTrendingTopic, { label: "First" });
    expect(callsTo("trending_topics", "insert")).toEqual([
      { label: "First", context: "", post_count: 0, rank: 1 },
    ]);
  });

  it("propagates a rank-query failure", async () => {
    db.listed.set("trending_topics", { data: null, error: { message: "rank failed" } });
    await expect(invoke(adminFns.adminCreateTrendingTopic, { label: "X" })).rejects.toMatchObject({
      message: "rank failed",
    });
  });

  it("propagates an insert failure", async () => {
    db.listed.set("trending_topics", { data: [{ rank: 1 }], error: null });
    db.insertError = { message: "insert failed" };
    await expect(invoke(adminFns.adminCreateTrendingTopic, { label: "X" })).rejects.toMatchObject({
      message: "insert failed",
    });
  });

  it("refuses non-admins before touching the database", async () => {
    requireAdminMock.mockRejectedValue(new Error("Unauthorized: admin access required."));
    await expect(invoke(adminFns.adminCreateTrendingTopic, { label: "X" })).rejects.toThrow(
      "Unauthorized",
    );
    expect(db.calls).toHaveLength(0);
  });
});

describe("adminDeleteTrendingTopic", () => {
  const UUID = "33333333-3333-4333-8333-333333333333";

  const badIdRows: Array<[label: string, id: unknown]> = [
    ["empty", ""],
    ["missing", undefined],
    ["not a uuid", "topic-1"],
  ];

  it.each(badIdRows)("rejects a %s id", async (_label, id) => {
    await expect(invoke(adminFns.adminDeleteTrendingTopic, { id })).rejects.toThrow(
      "Topic not found.",
    );
    expect(db.calls).toHaveLength(0);
  });

  it("deletes a valid topic id", async () => {
    await expect(invoke(adminFns.adminDeleteTrendingTopic, { id: UUID })).resolves.toEqual({
      ok: true,
    });
    expect(db.calls).toEqual([{ table: "trending_topics", op: "delete" }]);
  });
});

// ---------------------------------------------------------------------------
// grantAdminRole / revokeAdminRole
// ---------------------------------------------------------------------------

describe("grantAdminRole", () => {
  const badEmailRows: Array<[label: string, email: string]> = [
    ["empty", ""],
    ["missing @", "adminexample.com"],
    ["missing domain", "admin@"],
    ["missing TLD", "admin@example"],
    ["internal spaces", "ad min@example.com"],
    ["double @", "admin@@example.com"],
  ];

  it.each(badEmailRows)("rejects %s", async (_label, email) => {
    await expect(invoke(adminFns.grantAdminRole, { email })).rejects.toThrow(
      "That doesn't look like an email address.",
    );
    expect(db.calls).toHaveLength(0);
  });

  it("rejects when no auth account matches", async () => {
    db.users = [{ id: "u-other", email: "other@example.com" }];
    await expect(invoke(adminFns.grantAdminRole, { email: "admin@example.com" })).rejects.toThrow(
      "No account found with that email address.",
    );
    expect(callsTo("admin_roles", "upsert")).toHaveLength(0);
  });

  it("upserts the matched account by user_id", async () => {
    db.users = [{ id: "u-1", email: "admin@example.com" }];
    await expect(invoke(adminFns.grantAdminRole, { email: "Admin@Example.com" })).resolves.toEqual({
      ok: true,
    });
    expect(callsTo("admin_roles", "upsert")).toEqual([
      {
        payload: { user_id: "u-1", email: "admin@example.com" },
        opts: { onConflict: "user_id" },
      },
    ]);
  });

  it("matches the email case-insensitively", async () => {
    db.users = [{ id: "u-2", email: "MiXeD@Example.COM" }];
    await expect(invoke(adminFns.grantAdminRole, { email: "mixed@example.com" })).resolves.toEqual({
      ok: true,
    });
  });

  it("finds a match on the second page of auth users", async () => {
    db.users = [
      ...Array.from({ length: 100 }, (_, i) => ({ id: `filler-${i}`, email: `f${i}@x.co` })),
      { id: "u-page2", email: "late@example.com" },
    ];
    await expect(invoke(adminFns.grantAdminRole, { email: "late@example.com" })).resolves.toEqual({
      ok: true,
    });
    const pages = callsTo("auth", "listUsers");
    expect(pages).toEqual([1, 2]);
  });

  it("stops paging after 500 accounts", async () => {
    db.users = Array.from({ length: 500 }, (_, i) => ({ id: `u${i}`, email: `u${i}@x.co` }));
    await expect(invoke(adminFns.grantAdminRole, { email: "nobody@x.co" })).rejects.toThrow(
      "No account found with that email address.",
    );
    expect(callsTo("auth", "listUsers")).toEqual([1, 2, 3, 4, 5]);
  });

  it("propagates an upsert failure", async () => {
    db.users = [{ id: "u-1", email: "admin@example.com" }];
    db.upsertError = { message: "upsert failed" };
    await expect(
      invoke(adminFns.grantAdminRole, { email: "admin@example.com" }),
    ).rejects.toMatchObject({ message: "upsert failed" });
  });

  it("refuses non-admins before touching the database", async () => {
    requireAdminMock.mockRejectedValue(new Error("Unauthorized: admin access required."));
    await expect(invoke(adminFns.grantAdminRole, { email: "a@b.co" })).rejects.toThrow(
      "Unauthorized",
    );
    expect(db.calls).toHaveLength(0);
  });
});

describe("revokeAdminRole", () => {
  const UUID = "22222222-2222-4222-8222-222222222222";

  const badIdRows: Array<[label: string, userId: unknown]> = [
    ["empty", ""],
    ["missing", undefined],
    ["not a uuid", "user-1"],
  ];

  it.each(badIdRows)("rejects a %s userId", async (_label, userId) => {
    await expect(invoke(adminFns.revokeAdminRole, { userId })).rejects.toThrow("User not found.");
    expect(db.calls).toHaveLength(0);
  });

  it("deletes the role row by user_id", async () => {
    await expect(invoke(adminFns.revokeAdminRole, { userId: UUID })).resolves.toEqual({ ok: true });
    expect(db.calls).toEqual([{ table: "admin_roles", op: "delete" }]);
  });

  it("propagates a delete failure", async () => {
    db.deleteError = { message: "delete failed" };
    await expect(invoke(adminFns.revokeAdminRole, { userId: UUID })).rejects.toMatchObject({
      message: "delete failed",
    });
  });
});

// ---------------------------------------------------------------------------
// fetchAdminCampaigns / fetchAdminRoles — graceful degradation
// ---------------------------------------------------------------------------

describe("fetchAdminCampaigns", () => {
  const campaignRow = {
    id: "c1",
    name: "Boost",
    objective: "reach",
    status: "active",
    package: "basic",
    budget_cents: 1000,
    spend_cents: 100,
    currency: "USD",
    placement: "feed",
    impressions: 5,
    clicks: 2,
    engagements: 1,
    hides: 0,
    cta_label: "Learn",
    advertiser_id: "adv-1",
    post_id: "p-1",
    created_at: "2026-01-01",
  };

  it("joins advertiser names and post captions", async () => {
    db.listed.set("ad_campaigns", { data: [campaignRow], error: null });
    db.inRows.set("profiles", [{ id: "adv-1", username: "brand" }]);
    db.inRows.set("posts", [{ id: "p-1", caption: "Buy now" }]);
    const result = (await invoke(adminFns.fetchAdminCampaigns)) as {
      live: boolean;
      campaigns: { advertiser_name: string; post_caption: string }[];
    };
    expect(result.live).toBe(true);
    expect(result.campaigns[0]?.advertiser_name).toBe("brand");
    expect(result.campaigns[0]?.post_caption).toBe("Buy now");
  });

  it("defaults a missing advertiser name to '?'", async () => {
    db.listed.set("ad_campaigns", { data: [campaignRow], error: null });
    db.inRows.set("profiles", []);
    db.inRows.set("posts", []);
    const result = (await invoke(adminFns.fetchAdminCampaigns)) as {
      campaigns: { advertiser_name: string }[];
    };
    expect(result.campaigns[0]?.advertiser_name).toBe("?");
  });

  it("leaves post_caption empty for a campaign with no post", async () => {
    db.listed.set("ad_campaigns", { data: [{ ...campaignRow, post_id: null }], error: null });
    db.inRows.set("profiles", [{ id: "adv-1", username: "brand" }]);
    const result = (await invoke(adminFns.fetchAdminCampaigns)) as {
      campaigns: { post_caption: string }[];
    };
    expect(result.campaigns[0]?.post_caption).toBe("");
    expect(db.calls.filter((c) => c.table === "posts")).toHaveLength(0);
  });

  it("degrades to live:false when the query errors", async () => {
    db.listed.set("ad_campaigns", { data: null, error: { message: "boom" } });
    await expect(invoke(adminFns.fetchAdminCampaigns)).resolves.toEqual({
      campaigns: [],
      live: false,
    });
  });
});

describe("fetchAdminRoles", () => {
  it("returns the role rows with live:true", async () => {
    db.listed.set("admin_roles", {
      data: [{ user_id: "u1", email: "a@b.co", created_at: "2026-01-01" }],
      error: null,
    });
    await expect(invoke(adminFns.fetchAdminRoles)).resolves.toEqual({
      live: true,
      roles: [{ user_id: "u1", email: "a@b.co", created_at: "2026-01-01" }],
    });
  });

  it("degrades to live:false when the query errors", async () => {
    db.listed.set("admin_roles", { data: null, error: { message: "boom" } });
    await expect(invoke(adminFns.fetchAdminRoles)).resolves.toEqual({ roles: [], live: false });
  });

  it("refuses non-admins before touching the database", async () => {
    requireAdminMock.mockRejectedValue(new Error("Unauthorized: admin access required."));
    await expect(invoke(adminFns.fetchAdminRoles)).rejects.toThrow("Unauthorized");
    expect(db.calls).toHaveLength(0);
  });
});
