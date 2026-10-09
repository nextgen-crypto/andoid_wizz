import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "header.payload.signature";

function fakeRequest(token: string | null): Request {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request("http://localhost/api/test", { headers });
}

const stubSupabase = {
  auth: {
    getClaims: vi.fn(async () => ({
      data: { claims: { sub: "user-1", email: "a@b.c" } },
      error: null,
    })),
  },
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => stubSupabase,
}));

vi.mock("@tanstack/react-start/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tanstack/react-start/server")>();
  return { ...original, getRequest: () => fakeRequest(TOKEN) };
});

/**
 * Minimal createServerFn/createMiddleware harness: runs the middleware chain
 * and the handler in-process, mirroring the server callable's contract
 * ({ data } in, handler result out) without the SSR RPC runtime.
 */
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tanstack/react-start")>();
  const createMiddleware = (options: Record<string, unknown> = {}) => ({
    ...options,
    server: (fn: (ctx: { next: (ctx?: unknown) => Promise<void> }) => Promise<void>) => ({
      ...options,
      _server: fn,
    }),
  });
  interface ServerFnBuilder {
    _middleware: { _server?: (ctx: unknown) => Promise<void> }[];
    _validator: ((data: unknown) => unknown) | null;
    middleware(mws: unknown[]): ServerFnBuilder;
    inputValidator(validator: (data: unknown) => unknown): ServerFnBuilder;
    handler(
      fn: (args: { context: unknown; data: unknown }) => unknown,
    ): (opts?: { data?: unknown }) => Promise<unknown>;
  }
  const createServerFn = (options: Record<string, unknown> = {}): ServerFnBuilder => {
    const builder: ServerFnBuilder = {
      _middleware: [],
      _validator: null,
      middleware(mws: { _server?: (ctx: unknown) => Promise<void> }[]) {
        builder._middleware = [...builder._middleware, ...mws];
        return builder;
      },
      inputValidator(validator: (data: unknown) => unknown) {
        builder._validator = validator;
        return builder;
      },
      handler(fn: (args: { context: unknown; data: unknown }) => unknown) {
        return async ({ data }: { data?: unknown } = {}) => {
          const context: Record<string, unknown> = {};
          for (const mw of builder._middleware) {
            if (!mw._server) throw new Error("middleware is not a server middleware");
            await mw._server({
              context,
              next: async (nextCtx?: Record<string, unknown>) => {
                if (nextCtx?.["context"]) Object.assign(context, nextCtx["context"]);
              },
            });
          }
          const validated = builder._validator ? builder._validator(data) : data;
          return fn({ context, data: validated });
        };
      },
    };
    return builder;
  };
  return { ...original, createServerFn, createMiddleware };
});

const insertAdEvent = vi.fn(async () => ({ error: null }));
const upsertExposures = vi.fn(async () => ({ error: null }));
const exposureRow = {
  data: { impression_count: 5, interaction_count: 2, hidden: true },
  error: null,
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === "ad_events") return { insert: insertAdEvent };
      if (table === "ad_exposures") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => exposureRow),
              })),
            })),
          })),
          upsert: upsertExposures,
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  },
}));

process.env["SUPABASE_URL"] = "https://example.supabase.co";
process.env["SUPABASE_PUBLISHABLE_KEY"] = "sb_publishable_test";

const { logAdEvent } = await import("./ads.functions");

const CAMPAIGN_ID = "22222222-2222-2222-2222-222222222222";

describe("logAdEvent exposure bookkeeping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never resets hidden to false on non-hide events", async () => {
    const result = await logAdEvent({
      data: { campaignId: CAMPAIGN_ID, kind: "impression" },
    });
    expect(result).toEqual({ ok: true });
    expect(upsertExposures).toHaveBeenCalledWith(
      expect.objectContaining({ hidden: true, impression_count: 6 }),
      expect.anything(),
    );
  });

  it("sets hidden to true on hide events", async () => {
    await logAdEvent({ data: { campaignId: CAMPAIGN_ID, kind: "hide" } });
    expect(upsertExposures).toHaveBeenCalledWith(
      expect.objectContaining({ hidden: true }),
      expect.anything(),
    );
  });

  it("counts interactions without un-hiding", async () => {
    await logAdEvent({ data: { campaignId: CAMPAIGN_ID, kind: "click" } });
    expect(upsertExposures).toHaveBeenCalledWith(
      expect.objectContaining({ hidden: true, interaction_count: 3 }),
      expect.anything(),
    );
  });

  it("ignores invalid campaign ids and unknown kinds", async () => {
    await logAdEvent({ data: { campaignId: "nope", kind: "impression" } });
    await logAdEvent({ data: { campaignId: CAMPAIGN_ID, kind: "bogus" } });
    expect(insertAdEvent).not.toHaveBeenCalled();
    expect(upsertExposures).not.toHaveBeenCalled();
  });
});
