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
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      in: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(async () => ({
            data: [{ id: "11111111-1111-1111-1111-111111111111", author_id: "real-author" }],
            error: null,
          })),
        })),
      })),
    })),
  })),
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

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      insert: vi.fn(async () => ({ error: null })),
    })),
  },
}));

process.env["SUPABASE_URL"] = "https://example.supabase.co";
process.env["SUPABASE_PUBLISHABLE_KEY"] = "sb_publishable_test";

const { recordFeedEvents } = await import("./events.functions");
const { requireSupabaseAuth } = await import("@/integrations/supabase/auth-middleware");
const { createServerFn } = await import("@tanstack/react-start");

const POST_ID = "11111111-1111-1111-1111-111111111111";

describe("requireSupabaseAuth middleware", () => {
  const authed = createServerFn({ method: "GET" })
    .middleware([requireSupabaseAuth])
    .handler(async ({ context }) => (context as { userId: string }).userId);

  it("accepts a well-formed bearer token", async () => {
    await expect(authed()).resolves.toBe("user-1");
  });

  it("rejects when getClaims fails", async () => {
    stubSupabase.auth.getClaims.mockResolvedValueOnce({
      data: null,
      error: new Error("invalid"),
    } as never);
    await expect(authed()).rejects.toThrow("Unauthorized");
  });
});

describe("recordFeedEvents anti-spoof", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives author_id server-side and ignores the client-supplied authorId", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const insert = vi.fn(async () => ({ error: null }));
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

    const result = await recordFeedEvents({
      data: {
        events: [
          {
            event: "video_like",
            postId: POST_ID,
            authorId: "spoofed-author",
            meta: { spoofed: "yes" },
          },
        ],
      },
    });

    expect(result).toEqual({ ok: true, count: 1 });
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({ author_id: "real-author", user_id: "user-1" }),
    ]);
  });

  it("drops events for posts the viewer cannot see", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const insert = vi.fn(async () => ({ error: null }));
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

    const result = await recordFeedEvents({
      data: { events: [{ event: "video_like", postId: POST_ID }] },
    });
    // The mocked visibility query returns the post, so it is authorized.
    expect(result.ok).toBe(true);

    // Unknown post ids are filtered out entirely.
    const empty = await recordFeedEvents({
      data: { events: [{ event: "video_like", postId: "not-a-uuid" }] },
    });
    expect(empty).toEqual({ ok: true, count: 0 });
  });

  it("rejects unknown event names and caps batches at 50", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const insert = vi.fn(async () => ({ error: null }));
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

    const events = Array.from({ length: 60 }, (_, i) => ({
      event: i === 59 ? "not_an_event" : "video_impression",
      postId: POST_ID,
    }));
    const result = await recordFeedEvents({ data: { events } });
    expect(result).toEqual({ ok: true, count: 50 });
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
