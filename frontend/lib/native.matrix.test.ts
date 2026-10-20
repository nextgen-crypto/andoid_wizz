import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Table-driven matrix for frontend/lib/native.ts.
 *
 * The Capacitor modules are mocked so platform, CapacitorHttp and Browser are
 * fully deterministic in the node test environment; `window` is stubbed per
 * scenario (SSR has none, the web scenario has an origin, the native scenario
 * installs the RPC bridge). Scenarios run in file order because the bridge is
 * installed at most once per module instance.
 */

const { nativeFlag, capHttpRequest, browserOpen } = vi.hoisted(() => ({
  nativeFlag: { current: false },
  capHttpRequest: vi.fn(),
  browserOpen: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => nativeFlag.current },
  CapacitorHttp: { request: capHttpRequest },
}));

vi.mock("@capacitor/browser", () => ({ Browser: { open: browserOpen } }));

const WEB_ORIGIN = "https://wizz-kohl.vercel.app";

const native = await import("./native");

afterEach(() => {
  nativeFlag.current = false;
  capHttpRequest.mockReset();
  browserOpen.mockReset();
});

// ---------------------------------------------------------------------------
// Scenario A: SSR — no `window` at all.
// ---------------------------------------------------------------------------

describe("SSR (no window)", () => {
  beforeEach(() => {
    nativeFlag.current = false;
  });

  it("isNativePlatform() is false for the plain web platform", () => {
    expect(native.isNativePlatform()).toBe(false);
  });

  it("isNativePlatform() delegates to the Capacitor flag", () => {
    nativeFlag.current = true;
    expect(native.isNativePlatform()).toBe(true);
  });

  it("authRedirectOrigin() falls back to the public web origin", () => {
    expect(native.authRedirectOrigin()).toBe(WEB_ORIGIN);
  });

  it("authRedirectOrigin() stays on the web origin even when native", () => {
    nativeFlag.current = true;
    expect(native.authRedirectOrigin()).toBe(WEB_ORIGIN);
  });

  const ssrPaths: string[] = [
    "",
    "/",
    "/feed",
    "/posts/123",
    "feed",
    "/a?b=1#c",
    "/trail/",
    "/%20",
    "/ünicode",
    "posts/1",
    "http://x",
    "#hash",
    "?query",
    "/deep/nested/path",
    "//double",
  ];

  it.each(ssrPaths)("publicUrl(%j) returns the bare path during SSR", (path) => {
    expect(native.publicUrl(path)).toBe(path);
  });

  it.each(ssrPaths)("publicUrl(%j) on native falls back to the web origin", (path) => {
    nativeFlag.current = true;
    expect(native.publicUrl(path)).toBe(`${WEB_ORIGIN}${path}`);
  });

  it("installNativeRpcBridge() is a no-op without window", () => {
    expect(() => native.installNativeRpcBridge()).not.toThrow();
    expect(typeof window).toBe("undefined");
    expect(() => native.installNativeRpcBridge()).not.toThrow();
    expect(typeof window).toBe("undefined");
  });
});

// ---------------------------------------------------------------------------
// Scenario B: plain browser — window stubbed, not native.
// ---------------------------------------------------------------------------

const ORIGIN_A = "https://app.example";
const ORIGIN_B = "http://localhost:3000";
const ORIGIN_C = "https://wizz-kohl.vercel.app";
const ORIGIN_D = "null";

describe("web browser (window present, not native)", () => {
  beforeEach(() => {
    nativeFlag.current = false;
    vi.stubGlobal("window", {
      location: { origin: ORIGIN_A, href: "" },
      fetch: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const origins: string[] = [ORIGIN_A, ORIGIN_B, ORIGIN_C, ORIGIN_D, "https://example.com:8443"];

  it.each(origins)("authRedirectOrigin() returns the page origin %j", (origin) => {
    vi.stubGlobal("window", { location: { origin, href: "" }, fetch: vi.fn() });
    expect(native.authRedirectOrigin()).toBe(origin);
  });

  it.each(origins)("authRedirectOrigin() prefers the web origin over native %j", (origin) => {
    vi.stubGlobal("window", { location: { origin, href: "" }, fetch: vi.fn() });
    nativeFlag.current = true;
    expect(native.authRedirectOrigin()).toBe(WEB_ORIGIN);
  });

  const joinRows: Array<[string, string, string]> = [
    ["", ORIGIN_A, ORIGIN_B],
    ["/", `${ORIGIN_A}/`, `${ORIGIN_B}/`],
    ["/feed", `${ORIGIN_A}/feed`, `${ORIGIN_B}/feed`],
    ["/posts/123", `${ORIGIN_A}/posts/123`, `${ORIGIN_B}/posts/123`],
    ["feed", `${ORIGIN_A}feed`, `${ORIGIN_B}feed`],
    ["/trail/", `${ORIGIN_A}/trail/`, `${ORIGIN_B}/trail/`],
    ["/a?b=1#c", `${ORIGIN_A}/a?b=1#c`, `${ORIGIN_B}/a?b=1#c`],
    ["//double", `${ORIGIN_A}//double`, `${ORIGIN_B}//double`],
    ["#hash", `${ORIGIN_A}#hash`, `${ORIGIN_B}#hash`],
    ["?query=1", `${ORIGIN_A}?query=1`, `${ORIGIN_B}?query=1`],
    ["/ünicode", `${ORIGIN_A}/ünicode`, `${ORIGIN_B}/ünicode`],
    ["posts/1", `${ORIGIN_A}posts/1`, `${ORIGIN_B}posts/1`],
    ["http://x", `${ORIGIN_A}http://x`, `${ORIGIN_B}http://x`],
    ["/deep/nested/path", `${ORIGIN_A}/deep/nested/path`, `${ORIGIN_B}/deep/nested/path`],
    ["/%20", `${ORIGIN_A}/%20`, `${ORIGIN_B}/%20`],
  ];

  it.each(joinRows)("publicUrl(%j) joins onto origin A: %s", (path, expectedA) => {
    expect(native.publicUrl(path)).toBe(expectedA);
  });

  it.each(joinRows)("publicUrl(%j) joins onto origin B: %s", (path, _expectedA, expectedB) => {
    vi.stubGlobal("window", { location: { origin: ORIGIN_B, href: "" }, fetch: vi.fn() });
    expect(native.publicUrl(path)).toBe(expectedB);
  });

  it.each(joinRows)("publicUrl(%j) uses the public web origin when native", (path) => {
    nativeFlag.current = true;
    expect(native.publicUrl(path)).toBe(`${WEB_ORIGIN}${path}`);
  });

  it("installNativeRpcBridge() leaves fetch untouched on the web", () => {
    const before = window.fetch;
    native.installNativeRpcBridge();
    expect(window.fetch).toBe(before);
  });

  it("installNativeRpcBridge() is safe when window has no fetch", () => {
    vi.stubGlobal("window", { location: { origin: ORIGIN_A, href: "" } });
    expect(() => native.installNativeRpcBridge()).not.toThrow();
    expect((window as unknown as { fetch?: unknown }).fetch).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario C: native shell — window + bridge installed once.
// ---------------------------------------------------------------------------

describe("native shell (window + RPC bridge)", () => {
  const baseFetch = vi.fn();
  let wrapped: typeof fetch;
  const pageOrigin = "https://localhost";

  beforeAll(() => {
    vi.stubGlobal("window", {
      location: { origin: pageOrigin, href: "" },
      fetch: baseFetch,
    });
    nativeFlag.current = true;
    native.installNativeRpcBridge();
    wrapped = window.fetch as unknown as typeof fetch;
  });

  beforeEach(() => {
    capHttpRequest.mockReset();
    browserOpen.mockReset();
    baseFetch.mockReset();
    baseFetch.mockResolvedValue(new Response("passthrough", { status: 200 }));
    capHttpRequest.mockResolvedValue({ status: 200, headers: {}, data: "ok" });
  });

  it("replaces window.fetch exactly once", () => {
    expect(window.fetch).not.toBe(baseFetch);
    const snapshot = window.fetch;
    native.installNativeRpcBridge();
    native.installNativeRpcBridge();
    expect(window.fetch).toBe(snapshot);
    expect(window.fetch).toBe(wrapped);
  });

  // --- passthrough of non-server-function requests -------------------------

  const passthroughInputs: Array<[string, RequestInit | undefined]> = [
    ["/api/other", undefined],
    ["/_serverFnx/thing", undefined],
    ["/other/_serverFn/thing", undefined],
    ["https://app.example/api/data", undefined],
    ["", undefined],
    ["/", undefined],
    ["/not%20a%20serverfn", undefined],
    ["/_serverFn", undefined],
    ["/feed", { method: "POST" }],
  ];

  it.each(passthroughInputs)(
    "fetch(%j) goes to the stock path, not CapacitorHttp",
    async (input, init) => {
      await wrapped(input, init);
      expect(capHttpRequest).not.toHaveBeenCalled();
      expect(baseFetch).toHaveBeenCalledTimes(1);
      expect(baseFetch.mock.calls[0]?.[0]).toBe(input);
      if (init) expect(baseFetch.mock.calls[0]?.[1]).toBe(init);
    },
  );

  it("a FormData body keeps the stock fetch path", async () => {
    const form = new FormData();
    form.append("file", "x");
    await wrapped("/_serverFn/upload", { method: "POST", body: form });
    expect(capHttpRequest).not.toHaveBeenCalled();
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it("a Request instance for a non-serverFn URL uses the stock path", async () => {
    const req = new Request("https://app.example/api/things", { method: "PUT" });
    await wrapped(req);
    expect(capHttpRequest).not.toHaveBeenCalled();
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it("a Request carrying its own body is left to the stock path", async () => {
    const req = new Request("https://localhost/_serverFn/thing", {
      method: "POST",
      body: '{"a":1}',
    });
    await wrapped(req);
    expect(capHttpRequest).not.toHaveBeenCalled();
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  // --- forwarding to the deployed backend ----------------------------------

  const serverFnRows: Array<[string, RequestInit | undefined, string]> = [
    ["/_serverFn/fetchHome", undefined, `${WEB_ORIGIN}/_serverFn/fetchHome`],
    ["/_serverFn/fetchHome?a=1&b=2", undefined, `${WEB_ORIGIN}/_serverFn/fetchHome?a=1&b=2`],
    ["/_serverFn/x#frag", undefined, `${WEB_ORIGIN}/_serverFn/x`],
    ["https://evil.example/_serverFn/x", undefined, `${WEB_ORIGIN}/_serverFn/x`],
    ["//evil.example/_serverFn/x", undefined, `${WEB_ORIGIN}/_serverFn/x`],
    ["/_serverFn/a%20b", undefined, `${WEB_ORIGIN}/_serverFn/a%20b`],
    ["/_serverFn/fetchFeedPage", { method: "POST" }, `${WEB_ORIGIN}/_serverFn/fetchFeedPage`],
  ];

  it.each(serverFnRows)("fetch(%j) is forwarded to %s", async (input, init, expectedUrl) => {
    await wrapped(input, init);
    expect(capHttpRequest).toHaveBeenCalledTimes(1);
    const sent = capHttpRequest.mock.calls[0]?.[0] as {
      url: string;
      readTimeout: number;
      connectTimeout: number;
    };
    expect(sent.url).toBe(expectedUrl);
    expect(sent.readTimeout).toBe(30_000);
    expect(sent.connectTimeout).toBe(30_000);
  });

  const methodRows: Array<[RequestInit | undefined, string | undefined, string]> = [
    [undefined, undefined, "GET"],
    [{}, undefined, "GET"],
    [{ method: "post" }, undefined, "POST"],
    [{ method: "PUT" }, undefined, "PUT"],
    [{ method: "delete" }, undefined, "DELETE"],
    [undefined, "GET", "GET"],
    [{ method: "patch" }, "GET", "PATCH"],
  ];

  it.each(methodRows)(
    "method %s (init) / %s (Request) -> %s",
    async (init, reqMethod, expected) => {
      const input =
        reqMethod === undefined
          ? "/_serverFn/thing"
          : new Request("https://localhost/_serverFn/thing", { method: reqMethod });
      await wrapped(input, init);
      const sent = capHttpRequest.mock.calls[0]?.[0] as { method: string };
      expect(sent.method).toBe(expected);
    },
  );

  const bodyRows: Array<[RequestInit | undefined, string | null]> = [
    [undefined, null],
    [{ body: '{"a":1}' }, '{"a":1}'],
    [{ body: "" }, ""],
    [{ body: "plain text" }, "plain text"],
    [{ method: "POST" }, null],
    [{ method: "POST", body: "" }, ""],
    [{ method: "POST", body: '{"deep":{"n":[1,2,3]}}' }, '{"deep":{"n":[1,2,3]}}'],
  ];

  it.each(bodyRows)("body %s -> data %s", async (init, expectedData) => {
    await wrapped("/_serverFn/thing", init);
    const sent = capHttpRequest.mock.calls[0]?.[0] as { data?: string };
    if (expectedData === null) expect(sent).not.toHaveProperty("data");
    else expect(sent.data).toBe(expectedData);
  });

  it("merges Request headers with init headers and forces the Origin header", async () => {
    const req = new Request("https://localhost/_serverFn/thing", {
      headers: { "X-Req": "req-value" },
    });
    await wrapped(req, { headers: { "X-Init": "init-value" } });
    const sent = capHttpRequest.mock.calls[0]?.[0] as { headers: Record<string, string> };
    expect(sent.headers["x-req"]).toBe("req-value");
    expect(sent.headers["x-init"]).toBe("init-value");
    expect(sent.headers["Origin"]).toBe(WEB_ORIGIN);
  });

  it("adds Origin when the caller sent none", async () => {
    await wrapped("/_serverFn/thing");
    const sent = capHttpRequest.mock.calls[0]?.[0] as { headers: Record<string, string> };
    expect(sent.headers).toEqual({ Origin: WEB_ORIGIN });
  });

  it("accepts array-form headers", async () => {
    await wrapped("/_serverFn/thing", { headers: [["X-Pair", "p"]] });
    const sent = capHttpRequest.mock.calls[0]?.[0] as { headers: Record<string, string> };
    expect(sent.headers["x-pair"]).toBe("p");
    expect(sent.headers["Origin"]).toBe(WEB_ORIGIN);
  });

  it("always overwrites a caller-supplied Origin key (documented quirk: a lowercase duplicate survives)", async () => {
    await wrapped("/_serverFn/thing", { headers: { origin: "https://caller.example" } });
    const sent = capHttpRequest.mock.calls[0]?.[0] as { headers: Record<string, string> };
    expect(sent.headers["Origin"]).toBe(WEB_ORIGIN);
    expect(sent.headers["origin"]).toBe("https://caller.example");
  });

  it("uses init body even when a Request also carries one", async () => {
    const req = new Request("https://localhost/_serverFn/thing", {
      method: "POST",
      body: '{"ignored":true}',
    });
    await wrapped(req, { body: '{"used":true}' });
    const sent = capHttpRequest.mock.calls[0]?.[0] as { data?: string };
    expect(sent.data).toBe('{"used":true}');
    expect(capHttpRequest).toHaveBeenCalledTimes(1);
  });

  // --- response mapping -----------------------------------------------------

  const responseRows: Array<[number, unknown, number, string]> = [
    [200, { a: 1 }, 200, '{"a":1}'],
    [200, "raw payload", 200, "raw payload"],
    [200, "", 200, ""],
    [200, null, 200, ""],
    [200, undefined, 200, ""],
    [200, 42, 200, "42"],
    [200, true, 200, "true"],
    [200, [1, 2, 3], 200, "[1,2,3]"],
    [200, { nested: { list: [{ id: "x" }] } }, 200, '{"nested":{"list":[{"id":"x"}]}}'],
    [201, { id: "1" }, 201, '{"id":"1"}'],
    [202, "queued", 202, "queued"],
    [204, "ignored body", 204, ""],
    [204, { a: 1 }, 204, ""],
    [205, "ignored", 205, ""],
    [304, "ignored", 304, ""],
    [400, { error: "bad" }, 400, '{"error":"bad"}'],
    [401, "unauthorized", 401, "unauthorized"],
    [404, "not found", 404, "not found"],
    [500, { boom: true }, 500, '{"boom":true}'],
    [599, "edge status", 599, "edge status"],
  ];

  it.each(responseRows)(
    "CapacitorHttp status %s data %j -> Response %s body %j",
    async (status, data, expectedStatus, expectedBody) => {
      capHttpRequest.mockResolvedValueOnce({ status, headers: {}, data });
      const res = await wrapped("/_serverFn/thing");
      expect(res.status).toBe(expectedStatus);
      expect(await res.text()).toBe(expectedBody);
    },
  );

  it("forwards response headers case-insensitively", async () => {
    capHttpRequest.mockResolvedValueOnce({
      status: 200,
      headers: { "Content-Type": "application/json", "X-Trace": "abc" },
      data: '{"ok":true}',
    });
    const res = await wrapped("/_serverFn/thing");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("x-trace")).toBe("abc");
    expect(await res.text()).toBe('{"ok":true}');
  });

  const badHeaderRows: Array<[Record<string, unknown>, Record<string, string>]> = [
    [{ "bad header name": "x" }, {}],
    [{ "": "empty-name" }, {}],
    [{ "x-null": null }, {}],
    [{ "x-undefined": undefined }, {}],
    [
      { "x-num": 7, "x-bool": true },
      { "x-num": "7", "x-bool": "true" },
    ],
    [{ "x-ok": "kept" }, { "x-ok": "kept" }],
    [{ "x-ok": "kept", "bad header": "x", "x-null": null }, { "x-ok": "kept" }],
    [{ "X-Trace": "abc" }, { "x-trace": "abc" }],
  ];

  it.each(badHeaderRows)("header set %j -> response headers %j", async (headers, expected) => {
    capHttpRequest.mockResolvedValueOnce({ status: 200, headers, data: "payload" });
    const res = await wrapped("/_serverFn/thing");
    const actual = Object.fromEntries(res.headers.entries());
    // The Response constructor stamps a default content-type for string bodies.
    delete actual["content-type"];
    expect(actual).toEqual(expected);
    expect(await res.text()).toBe("payload");
  });

  // --- failure mapping ------------------------------------------------------

  const failureStatuses: unknown[] = [0, 1, 199, 600, 1000, undefined, null, NaN, -1];

  it.each(failureStatuses)("status %s rejects with a fetch-style TypeError", async (status) => {
    capHttpRequest.mockResolvedValueOnce({ status, headers: {}, data: "x" });
    const error: unknown = await wrapped("/_serverFn/thing").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe("Failed to fetch");
  });

  it("a rejected CapacitorHttp request becomes a fetch-style TypeError", async () => {
    capHttpRequest.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(wrapped("/_serverFn/thing")).rejects.toBeInstanceOf(TypeError);
  });

  it("a rejected CapacitorHttp request reports Failed to fetch", async () => {
    capHttpRequest.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(wrapped("/_serverFn/thing")).rejects.toThrow("Failed to fetch");
  });

  // --- openExternalUrl ------------------------------------------------------

  const externalUrls: string[] = [
    "https://example.com/checkout",
    "https://wizz-kohl.vercel.app/posts/1",
    "mailto:hi@example.com",
    "tel:+255700000000",
    "intent://scan#Intent;scheme=zxing;end",
    "https://apps.apple.com/app/id000",
    "about:blank",
    "/relative/page",
  ];

  it.each(externalUrls)("openExternalUrl(%j) opens the system browser on native", async (url) => {
    nativeFlag.current = true;
    await native.openExternalUrl(url);
    expect(browserOpen).toHaveBeenCalledWith({ url });
    expect(window.location.href).toBe("");
  });

  it.each(externalUrls)("openExternalUrl(%j) assigns location.href on the web", async (url) => {
    nativeFlag.current = false;
    await native.openExternalUrl(url);
    expect(browserOpen).not.toHaveBeenCalled();
    expect(window.location.href).toBe(url);
  });

  it("isNativePlatform() reads the mocked platform flag", () => {
    nativeFlag.current = true;
    expect(native.isNativePlatform()).toBe(true);
    nativeFlag.current = false;
    expect(native.isNativePlatform()).toBe(false);
  });

  it("publicUrl() on native ignores the WebView origin", () => {
    nativeFlag.current = true;
    expect(native.publicUrl("/feed")).toBe(`${WEB_ORIGIN}/feed`);
    expect(native.publicUrl("")).toBe(WEB_ORIGIN);
  });

  it("authRedirectOrigin() on native ignores the WebView origin", () => {
    nativeFlag.current = true;
    expect(native.authRedirectOrigin()).toBe(WEB_ORIGIN);
  });
});
