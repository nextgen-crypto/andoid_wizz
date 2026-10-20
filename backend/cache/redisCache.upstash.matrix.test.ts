import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/**
 * Table-driven matrix for the Upstash (REST) backend of backend/cache/redisCache.ts.
 *
 * The Upstash client is exercised through `cacheAside` / `invalidate` with a
 * stubbed global `fetch` — either a scripted response (protocol/edge-case
 * rows) or a tiny in-process pipeline executor that mimics the Redis subset
 * the cache uses (behavioural rows). No network access.
 *
 * The env must be stubbed before the first cache call so `client()` builds an
 * UpstashCache, and most rows use a fresh top-level namespace so the
 * module-level epoch memo cannot leak between tests.
 */

const UPSTASH_URL = "https://example.upstash.io";
const UPSTASH_TOKEN = "test-token";

vi.stubEnv("UPSTASH_REDIS_REST_URL", UPSTASH_URL);
vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", UPSTASH_TOKEN);

const { TTL, VersionedCache, cacheAside, cacheBackend, cacheStats, invalidate } =
  await import("./redisCache");

type PipelineCommand = unknown[];
type FetchCall = [input: RequestInfo | URL, init?: RequestInit];

let namespaceSeq = 0;
/** Fresh top-level namespace for a row — the epoch memo is module-level. */
function freshTop(): string {
  namespaceSeq += 1;
  return `ns${namespaceSeq}`;
}

function commandsOf(fetchMock: { mock: { calls: unknown[][] } }): PipelineCommand[] {
  return fetchMock.mock.calls.map((call) => {
    const body = String((call as FetchCall)[1]?.body);
    return (JSON.parse(body) as PipelineCommand[])[0] as PipelineCommand;
  });
}

function jsonBody(result: unknown): Response {
  return new Response(JSON.stringify([{ result }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Scripted fetch: resolves with a pipeline response, or fails as configured. */
function scriptedFetch(mode: "ok" | "reject" | "http-error", result: unknown = null) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    if (mode === "reject") throw new TypeError("Failed to fetch");
    if (mode === "http-error") return new Response("boom", { status: 500 });
    return jsonBody(result);
  });
}

/**
 * Fetch where epoch probes miss (GET of `__epoch__:*` -> null) and every other
 * command succeeds. Epoch 0 means `resolve()` keeps keys literal, which is what
 * the exact-command assertions below depend on.
 */
function epochZeroFetch() {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const cmd = firstCmd(init);
    return jsonBody(String(cmd[0]) === "GET" ? null : "OK");
  });
}

/** First command of a pipeline body; throws instead of silently becoming undefined. */
function firstCmd(init: RequestInit | undefined): PipelineCommand {
  const parsed = JSON.parse(String(init?.body)) as PipelineCommand[];
  const cmd = parsed[0];
  if (!cmd) throw new Error("empty pipeline body");
  return cmd;
}

/** Minimal in-process pipeline executor for GET/SET/DEL/EXPIRE/INCRBY. */
function makeFakeUpstash() {
  const store = new Map<string, string>();
  const calls: PipelineCommand[] = [];
  const behavior = { failNetwork: false, httpStatus: 200 };

  const exec = (cmd: PipelineCommand): unknown => {
    const op = String(cmd[0]);
    if (op === "GET") {
      const key = String(cmd[1]);
      return store.has(key) ? (store.get(key) as string) : null;
    }
    if (op === "SET") {
      store.set(String(cmd[1]), String(cmd[2]));
      return "OK";
    }
    if (op === "DEL") {
      let deleted = 0;
      for (const key of cmd.slice(1)) if (store.delete(String(key))) deleted += 1;
      return deleted;
    }
    if (op === "EXPIRE") return 1;
    if (op === "INCRBY") {
      const key = String(cmd[1]);
      const next = Number(store.get(key) ?? "0") + Number(cmd[2]);
      store.set(key, String(next));
      return next;
    }
    throw new Error(`unsupported command ${op}`);
  };

  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const pipeline = JSON.parse(String(init?.body)) as PipelineCommand[];
      for (const cmd of pipeline) calls.push(cmd);
      if (behavior.failNetwork) throw new TypeError("Failed to fetch");
      if (behavior.httpStatus !== 200) return new Response("boom", { status: behavior.httpStatus });
      const results = pipeline.map(exec);
      return new Response(JSON.stringify(results.map((result) => ({ result }))), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );

  return { store, calls, behavior, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

describe("backend selection with Upstash env present", () => {
  it("cacheBackend() reports upstash", () => {
    expect(cacheBackend()).toBe("upstash");
  });

  it("cacheStats() reports upstash with null hit/miss counters", () => {
    expect(cacheStats()).toEqual({ backend: "upstash", hits: null, misses: null });
  });

  it("cacheBackend() is stable across repeated calls", () => {
    expect(cacheBackend()).toBe("upstash");
    expect(cacheBackend()).toBe("upstash");
    expect(cacheStats().backend).toBe("upstash");
  });
});

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

describe("cacheAside — exact wire format for a cold read/write", () => {
  const rows: Array<[string, unknown]> = [
    ["string payload", "value"],
    ["number payload", 42],
    ["object payload", { a: 1, nested: { b: [1, 2] } }],
    ["array payload", [1, "two", null]],
    ["empty string payload", ""],
    ["false payload", false],
    ["unicode payload", "🔥 Ünïcode"],
    ["long payload", "x".repeat(1_000)],
  ];

  it.each(rows)("%s", async (label, value) => {
    const fetchMock = scriptedFetch("ok", null);
    vi.stubGlobal("fetch", fetchMock);
    const top = freshTop();
    const key = `${top}:payload:${label.replace(/[^a-z]/gi, "")}`;

    await expect(cacheAside(key, 60, async () => value)).resolves.toEqual(value);

    const commands = commandsOf(fetchMock);
    expect(commands).toHaveLength(3);
    expect(commands[0]).toEqual(["GET", `__epoch__:${top}`]);
    expect(commands[1]).toEqual(["GET", key]);
    expect(commands[2]).toEqual(["SET", key, JSON.stringify(value), "EX", expect.any(Number)]);

    const call = fetchMock.mock.calls[0] as FetchCall;
    expect(String(call[0])).toBe(`${UPSTASH_URL}/pipeline`);
    const init = call[1];
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${UPSTASH_TOKEN}`);
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("sends the pipeline as a JSON array holding exactly one command", async () => {
    const fetchMock = scriptedFetch("ok", null);
    vi.stubGlobal("fetch", fetchMock);
    await cacheAside(`${freshTop()}:x`, 60, async () => "v");
    for (const call of fetchMock.mock.calls as FetchCall[]) {
      const parsed = JSON.parse(String(call[1]?.body)) as unknown[];
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(Array.isArray(parsed[0])).toBe(true);
    }
  });

  it("serves a cache hit with a single GET (no epoch probe, no SET)", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const cmd = firstCmd(init);
        if (String(cmd[0]) !== "GET") return jsonBody("OK");
        if (String(cmd[1]).startsWith("__epoch__:")) return jsonBody(null);
        return jsonBody(JSON.stringify("hit-value"));
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const top = freshTop();
    const key = `${top}:hit`;
    // Warm the module-level epoch memo for this top so the hit below needs no
    // epoch probe (resolve() memoizes per top-level namespace).
    await cacheAside(`${top}:warmup`, 60, async () => "warmup");
    fetchMock.mockClear();

    await expect(cacheAside(key, 60, async () => "loaded")).resolves.toBe("hit-value");
    expect(commandsOf(fetchMock)).toEqual([["GET", key]]);
  });
});

describe("cacheAside — EX ttl jitter stays inside ±20%", () => {
  const rows: Array<[number, number, number]> = [
    // [ttl seconds, lower bound, upper bound]
    [1, 1, 1],
    [45, 36, 54],
    [60, 48, 72],
    [90, 72, 108],
    [120, 96, 144],
    [180, 144, 216],
    [300, 240, 360],
    [86_400, 69_120, 103_680],
    [0, 1, 1],
    [-3, 1, 1],
  ];

  it.each(rows)("ttl=%is -> EX within [%i, %i]", async (ttl, min, max) => {
    const fetchMock = scriptedFetch("ok", null);
    vi.stubGlobal("fetch", fetchMock);
    const key = `${freshTop()}:ttl`;
    await cacheAside(key, ttl, async () => "v");

    const set = commandsOf(fetchMock).find((cmd) => String(cmd[0]) === "SET");
    expect(set).toBeDefined();
    const command = set as PipelineCommand;
    expect(command[0]).toBe("SET");
    expect(command[1]).toBe(key);
    expect(command[3]).toBe("EX");
    const ex = command[4] as number;
    expect(Number.isInteger(ex)).toBe(true);
    expect(ex).toBeGreaterThanOrEqual(min);
    expect(ex).toBeLessThanOrEqual(max);
  });
});

// ---------------------------------------------------------------------------
// Invalidation commands
// ---------------------------------------------------------------------------

describe("invalidate — commands on the wire", () => {
  const deleteRows: Array<["post" | "profile" | "trending", string, string]> = [
    ["post", "p-shape-1", "post:p-shape-1"],
    ["post", "11111111-1111-1111-1111-111111111111", "post:11111111-1111-1111-1111-111111111111"],
    ["profile", "u-shape-1", "profile:u-shape-1"],
    ["trending", "trending-shape-1", "trending:trending-shape-1"],
    ["trending", "TZ", "trending:TZ"],
  ];

  it.each(deleteRows)("invalidate.%s(%j) issues exactly one DEL", async (op, arg, expectedKey) => {
    const fetchMock = epochZeroFetch();
    vi.stubGlobal("fetch", fetchMock);
    await invalidate[op](arg);
    const commands = commandsOf(fetchMock);
    expect(commands).toContainEqual(["DEL", expectedKey]);
    expect(commands.filter((cmd) => String(cmd[0]) === "DEL")).toHaveLength(1);
  });

  const prefixRows: Array<["feed" | "candidates" | "stories", string]> = [
    ["feed", "__epoch__:feed"],
    ["candidates", "__epoch__:candidates"],
    ["stories", "__epoch__:stories"],
  ];

  it.each(prefixRows)("invalidate.%s() bumps the namespace epoch", async (op, epochKey) => {
    const fetchMock = epochZeroFetch();
    vi.stubGlobal("fetch", fetchMock);
    if (op === "feed") await invalidate.feed("any-user");
    else if (op === "candidates") await invalidate.candidates();
    else await invalidate.stories();

    const commands = commandsOf(fetchMock);
    const probe = commands.find((cmd) => String(cmd[0]) === "GET" && cmd[1] === epochKey);
    const bump = commands.find((cmd) => String(cmd[0]) === "SET" && cmd[1] === epochKey);
    expect(bump).toBeDefined();
    const bumpCommand = bump as PipelineCommand;
    expect(bumpCommand[2]).toBe("1");
    expect(bumpCommand[3]).toBe("EX");
    const ex = bumpCommand[4] as number;
    expect(ex).toBeGreaterThanOrEqual(Math.floor(TTL.config * 0.8));
    expect(ex).toBeLessThanOrEqual(Math.ceil(TTL.config * 1.2));
    if (probe) expect(commands.indexOf(probe)).toBeLessThan(commands.indexOf(bumpCommand));
    // A prefix invalidation never DELs the keyspace.
    expect(commands.some((cmd) => String(cmd[0]) === "DEL")).toBe(false);
  });

  it("invalidate.feedAll() bumps the feed epoch with no DEL", async () => {
    const fetchMock = epochZeroFetch();
    vi.stubGlobal("fetch", fetchMock);
    await invalidate.feedAll();
    const commands = commandsOf(fetchMock);
    const bump = commands.find((cmd) => String(cmd[0]) === "SET" && cmd[1] === "__epoch__:feed");
    expect(bump).toBeDefined();
    expect((bump as PipelineCommand)[2]).toBe("1");
    expect(commands.some((cmd) => String(cmd[0]) === "DEL")).toBe(false);
  });

  it("every invalidate helper is a function", () => {
    expect(invalidate.post).toBeTypeOf("function");
    expect(invalidate.profile).toBeTypeOf("function");
    expect(invalidate.trending).toBeTypeOf("function");
    expect(invalidate.feed).toBeTypeOf("function");
    expect(invalidate.feedAll).toBeTypeOf("function");
    expect(invalidate.candidates).toBeTypeOf("function");
    expect(invalidate.stories).toBeTypeOf("function");
  });
});

// ---------------------------------------------------------------------------
// Behavioural rows against the in-process pipeline executor
// ---------------------------------------------------------------------------

describe("cacheAside over the fake Upstash", () => {
  const valueRows: Array<[string, unknown]> = [
    ["string", "payload"],
    ["number", 42],
    ["zero", 0],
    ["false", false],
    ["empty string", ""],
    ["object", { id: "1", items: [1, 2, 3] }],
    ["nested", { a: { b: { c: "deep" } } }],
    ["unicode", "Ünïcode 🔥"],
    ["long string", "x".repeat(5_000)],
  ];

  it.each(valueRows)("round-trips a %s value", async (label, value) => {
    const fake = makeFakeUpstash();
    vi.stubGlobal("fetch", fake.fetchMock);
    const key = `${freshTop()}:round:${label.replace(/[^a-z]/gi, "")}`;

    const loader = vi.fn(async () => value);
    await expect(cacheAside(key, 60, loader)).resolves.toEqual(value);
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(cacheAside(key, 60, loader)).resolves.toEqual(value);
    expect(loader).toHaveBeenCalledTimes(1);

    // Stored under the literal key (epoch 0) as JSON.
    expect(fake.store.has(key)).toBe(true);
    expect(JSON.parse(fake.store.get(key) as string)).toEqual(value);
  });

  it("a stored JSON null counts as a miss, exactly like the in-process cache", async () => {
    const fake = makeFakeUpstash();
    vi.stubGlobal("fetch", fake.fetchMock);
    const key = `${freshTop()}:null`;
    const loader = vi.fn(async () => null);
    await expect(cacheAside(key, 60, loader)).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(fake.store.has(key)).toBe(true);
    await expect(cacheAside(key, 60, loader)).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("different keys are loaded independently", async () => {
    const fake = makeFakeUpstash();
    vi.stubGlobal("fetch", fake.fetchMock);
    const top = freshTop();
    const a = vi.fn(async () => "A");
    const b = vi.fn(async () => "B");
    await expect(cacheAside(`${top}:a`, 60, a)).resolves.toBe("A");
    await expect(cacheAside(`${top}:b`, 60, b)).resolves.toBe("B");
    await expect(cacheAside(`${top}:a`, 60, a)).resolves.toBe("A");
    await expect(cacheAside(`${top}:b`, 60, b)).resolves.toBe("B");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  const invalidationRows: Array<["post" | "profile" | "trending", string, string]> = [
    ["post", "p-inv-1", "post:p-inv-1"],
    ["post", "p-inv-2", "post:p-inv-2"],
    ["profile", "u-inv-1", "profile:u-inv-1"],
    ["trending", "tr-inv-1", "trending:tr-inv-1"],
  ];

  it.each(invalidationRows)(
    "invalidate.%s(%j) forces the next read to reload",
    async (op, arg, key) => {
      const fake = makeFakeUpstash();
      vi.stubGlobal("fetch", fake.fetchMock);

      const warm = vi.fn(async () => "warm");
      await expect(cacheAside(key, 60, warm)).resolves.toBe("warm");
      expect(warm).toHaveBeenCalledTimes(1);

      await invalidate[op](arg);

      const cold = vi.fn(async () => "cold");
      await expect(cacheAside(key, 60, cold)).resolves.toBe("cold");
      expect(cold).toHaveBeenCalledTimes(1);
      expect(warm).toHaveBeenCalledTimes(1);
    },
  );

  it("namespace versioning keeps the literal stored but unreachable", async () => {
    const fake = makeFakeUpstash();
    vi.stubGlobal("fetch", fake.fetchMock);
    const top = freshTop();
    const key = `${top}:user:u1:neutral:c1`;

    await cacheAside(key, 60, async () => "v1");
    expect(fake.store.has(key)).toBe(true);

    // A second wrapper over the same store performs the prefix invalidation.
    const wrapper = new VersionedCache({
      get: async <T>(k: string): Promise<T | null> => {
        const value = fake.store.has(k) ? (fake.store.get(k) as string) : null;
        return value === null ? null : (JSON.parse(value) as T);
      },
      set: async (k: string, v: unknown): Promise<void> => {
        fake.store.set(k, JSON.stringify(v));
      },
      del: async (k: string): Promise<void> => {
        fake.store.delete(k);
      },
      incrBy: async (): Promise<number> => 0,
    });

    await wrapper.delPrefix(`${top}:`);
    expect(fake.store.get(`__epoch__:${top}`)).toBe("1");
    expect(await wrapper.get(key)).toBeNull();
    expect(fake.store.has(key)).toBe(true); // literal survives, unreachable
    await wrapper.set(key, "v2", 60);
    expect(await wrapper.get(key)).toBe("v2");
    expect(fake.store.has(`${top}:~v1~:user:u1:neutral:c1`)).toBe(true);
    expect(await wrapper.get(`${top}:~v0~:user:u1:neutral:c1`)).toBeNull();
  });

  it("a prefix invalidation reloads every member of the namespace", async () => {
    const fake = makeFakeUpstash();
    vi.stubGlobal("fetch", fake.fetchMock);
    // Sync this store's epoch with the module-level memo first, so the
    // invalidation below deterministically moves the namespace forward.
    await invalidate.feed("any-user");
    const keys = ["feed:user:pi-a:1", "feed:user:pi-b:1", "feed:user:pi-c:1"];
    for (const key of keys) {
      const warm = vi.fn(async () => "warm");
      await expect(cacheAside(key, 60, warm)).resolves.toBe("warm");
      expect(warm).toHaveBeenCalledTimes(1);
    }

    await invalidate.feed("any-user");

    for (const key of keys) {
      const cold = vi.fn(async () => "cold");
      await expect(cacheAside(key, 60, cold)).resolves.toBe("cold");
      expect(cold).toHaveBeenCalledTimes(1);
    }
    // The old v1 keys are still in the store — only the epoch moved.
    expect(fake.store.has("feed:~v1~:user:pi-a:1")).toBe(true);
    expect(fake.store.get("__epoch__:feed")).toBe("2");
  });

  it("single-key invalidation does not disturb sibling keys", async () => {
    const fake = makeFakeUpstash();
    vi.stubGlobal("fetch", fake.fetchMock);
    const siblings = ["post:sib-1", "post:sib-2", "post:sib-3"];
    for (const key of siblings) {
      const warm = vi.fn(async () => "warm");
      await cacheAside(key, 60, warm);
      expect(warm).toHaveBeenCalledTimes(1);
    }

    await invalidate.post("sib-2");

    const reloaded = vi.fn(async () => "cold");
    await expect(cacheAside("post:sib-2", 60, reloaded)).resolves.toBe("cold");
    expect(reloaded).toHaveBeenCalledTimes(1);

    for (const key of ["post:sib-1", "post:sib-3"]) {
      const warm = vi.fn(async () => "warm");
      await expect(cacheAside(key, 60, warm)).resolves.toBe("warm");
      expect(warm).not.toHaveBeenCalled();
    }
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation — the cache must never break a request
// ---------------------------------------------------------------------------

describe("cacheAside — cache unavailable falls through to the loader", () => {
  const modes: Array<["reject" | "http-error", string]> = [
    ["reject", "network failure"],
    ["http-error", "upstream 500"],
  ];

  it.each(modes)("every call loads fresh on %s", async (mode) => {
    const fetchMock = scriptedFetch(mode);
    vi.stubGlobal("fetch", fetchMock);
    const key = `${freshTop()}:degraded`;
    const loader = vi.fn(async () => "fresh");

    await expect(cacheAside(key, 60, loader)).resolves.toBe("fresh");
    await expect(cacheAside(key, 60, loader)).resolves.toBe("fresh");
    await expect(cacheAside(key, 60, loader)).resolves.toBe("fresh");
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it.each(modes)(
    "a write failure on %s still serves the loaded value and never caches it",
    async (mode) => {
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const cmd = firstCmd(init);
          if (String(cmd[0]) === "GET") return jsonBody(null);
          if (mode === "reject") throw new TypeError("Failed to fetch");
          return new Response("boom", { status: 500 });
        },
      );
      vi.stubGlobal("fetch", fetchMock);
      const key = `${freshTop()}:write-fail`;
      const loader = vi.fn(async () => "loaded");

      await expect(cacheAside(key, 60, loader)).resolves.toBe("loaded");
      expect(loader).toHaveBeenCalledTimes(1);
      await expect(cacheAside(key, 60, loader)).resolves.toBe("loaded");
      expect(loader).toHaveBeenCalledTimes(2);
    },
  );

  it("a read failure after a warm write reloads instead of serving stale data", async () => {
    const fake = makeFakeUpstash();
    vi.stubGlobal("fetch", fake.fetchMock);
    const key = `${freshTop()}:warm-then-fail`;
    const warm = vi.fn(async () => "v1");
    await cacheAside(key, 60, warm);
    expect(warm).toHaveBeenCalledTimes(1);

    fake.behavior.failNetwork = true;
    const cold = vi.fn(async () => "v2");
    await expect(cacheAside(key, 60, cold)).resolves.toBe("v2");
    expect(cold).toHaveBeenCalledTimes(1);
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it("non-JSON store content counts as a miss and is repaired", async () => {
    const fake = makeFakeUpstash();
    vi.stubGlobal("fetch", fake.fetchMock);
    const key = `${freshTop()}:corrupt`;
    fake.store.set(key, "{not json");
    const loader = vi.fn(async () => "repaired");
    await expect(cacheAside(key, 60, loader)).resolves.toBe("repaired");
    expect(loader).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fake.store.get(key) as string)).toBe("repaired");
    const again = vi.fn(async () => "again");
    await expect(cacheAside(key, 60, again)).resolves.toBe("repaired");
    expect(again).not.toHaveBeenCalled();
  });

  const storedRawRows: Array<[string, string, unknown, boolean]> = [
    // [label, raw store content, expected value, loader runs?]
    ["invalid JSON", "plain-text", "loaded", true],
    ["an empty string", "", "loaded", true],
    ["JSON null", "null", "loaded", true],
    ["a bare number", "42", 42, false],
    ["a bare boolean", "true", true, false],
    ["a quoted string", '"stored-string"', "stored-string", false],
    ["a bare object", '{"a":1}', { a: 1 }, false],
    ["a bare array", "[1,2,3]", [1, 2, 3], false],
  ];

  it.each(storedRawRows)(
    "raw store content (%s) -> %s (loader runs: %s)",
    async (_label, raw, expected, loaderRuns) => {
      const fake = makeFakeUpstash();
      vi.stubGlobal("fetch", fake.fetchMock);
      const key = `${freshTop()}:raw`;
      fake.store.set(key, raw);
      const loader = vi.fn(async () => "loaded");
      const result = await cacheAside(key, 60, loader);
      expect(result).toEqual(expected);
      if (loaderRuns) expect(loader).toHaveBeenCalledTimes(1);
      else expect(loader).not.toHaveBeenCalled();
    },
  );

  const scriptedRows: Array<{ status: number; body: string }> = [
    { status: 200, body: "[]" },
    { status: 200, body: "[{}]" },
    { status: 200, body: '[{"result":null}]' },
    { status: 200, body: "not json" },
    { status: 401, body: '[{"result":"x"}]' },
    { status: 429, body: '[{"result":"x"}]' },
    { status: 500, body: "" },
    { status: 200, body: '[{"result":' },
  ];

  it.each(scriptedRows)("upstream response %j -> treated as a miss", async (response) => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(response.body, { status: response.status }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const key = `${freshTop()}:scripted`;
    const loader = vi.fn(async () => "fresh");
    await expect(cacheAside(key, 60, loader)).resolves.toBe("fresh");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("a non-string JSON result still parses (JSON.parse coerces)", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response('[{"result":42}]', { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const key = `${freshTop()}:numeric-result`;
    const loader = vi.fn(async () => "fresh");
    await expect(cacheAside(key, 60, loader)).resolves.toBe(42);
    expect(loader).not.toHaveBeenCalled();
  });

  it("a loader rejection propagates and caches nothing", async () => {
    const fake = makeFakeUpstash();
    vi.stubGlobal("fetch", fake.fetchMock);
    const key = `${freshTop()}:loader-error`;
    const failing = vi.fn(async () => {
      throw new Error("loader boom");
    });
    await expect(cacheAside(key, 60, failing)).rejects.toThrow("loader boom");
    expect(fake.store.has(key)).toBe(false);
    await expect(cacheAside(key, 60, async () => "recovered")).resolves.toBe("recovered");
  });
});
