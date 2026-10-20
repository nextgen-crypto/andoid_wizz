import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  InMemoryCache,
  TTL,
  VersionedCache,
  cacheAside,
  cacheBackend,
  cacheKeys,
  cacheStats,
  invalidate,
} from "./redisCache";

/**
 * Table-driven matrix for the cache contract: exact key strings, exact TTLs,
 * in-process cache semantics, versioned invalidation and cache-aside reads.
 *
 * The module-level client must resolve to the in-process backend for this
 * file, so the Upstash env is stubbed empty before the first cache call.
 * (redisCache.upstash.matrix.test.ts covers the Upstash backend separately.)
 */
vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");

const BASE = Date.UTC(2026, 9, 20, 12, 0, 0);

beforeAll(() => {
  expect(cacheBackend()).toBe("memory");
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// cacheKeys — exact strings
// ---------------------------------------------------------------------------

describe("cacheKeys — exact key strings", () => {
  const rows: Array<[string, unknown[], string]> = [
    ["feed", ["u1", "c1"], "feed:user:u1:neutral:c1"],
    ["feed", ["u1", "cursor-2"], "feed:user:u1:neutral:cursor-2"],
    ["feed", ["u1", "c1", "fast"], "feed:user:u1:fast:c1"],
    ["feed", ["u1", "", ""], "feed:user:u1::"],
    ["feed", ["u1", "c"], "feed:user:u1:neutral:c"],
    ["feed", ["user:with:colons", "c"], "feed:user:user:with:colons:neutral:c"],
    ["feed", ["u1", "🔥", "mobile"], "feed:user:u1:mobile:🔥"],
    ["feed", ["u1", "a b"], "feed:user:u1:neutral:a b"],
    ["feedAll", ["u1"], "feed:user:u1:"],
    ["feedAll", ["u1:2"], "feed:user:u1:2:"],
    ["feedAll", [""], "feed:user::"],
    ["candidates", ["v1"], "candidates:viewer:v1"],
    ["candidates", [""], "candidates:viewer:"],
    ["candidates", ["a b c"], "candidates:viewer:a b c"],
    ["post", ["p1"], "post:p1"],
    ["post", ["11111111-1111-1111-1111-111111111111"], "post:11111111-1111-1111-1111-111111111111"],
    ["post", [""], "post:"],
    ["profile", ["u1"], "profile:u1"],
    ["profile", ["u-alex"], "profile:u-alex"],
    ["profile", [""], "profile:"],
    ["stories", ["v1"], "stories:viewer:v1"],
    ["stories", [""], "stories:viewer:"],
    ["trending", ["global"], "trending:global"],
    ["trending", ["TZ"], "trending:TZ"],
    ["trending", ["a:b"], "trending:a:b"],
    ["news", ["general"], "news:general"],
    ["news", ["TECH"], "news:TECH"],
    ["news", ["a b"], "news:a b"],
    ["explore", ["music", "c2"], "explore:music:c2"],
    ["explore", ["", ""], "explore::"],
    ["explore", ["x", "🔥cursor"], "explore:x:🔥cursor"],
    ["recommendations", ["u1"], "recommendations:u1"],
    ["recommendations", [""], "recommendations:"],
    ["search", ["hello world"], "search:hello world"],
    ["search", [""], "search:"],
    ["search", [",()%"], "search:,()%"],
    ["search", ["🔥 hot"], "search:🔥 hot"],
  ];

  it.each(rows)("cacheKeys.%s(%j) -> %j", (builder, args, expected) => {
    const fn = (cacheKeys as unknown as Record<string, (...a: string[]) => string | undefined>)[
      builder
    ];
    expect(typeof fn).toBe("function");
    expect(fn?.(...(args as string[]))).toBe(expected);
  });

  const constRows: Array<[string, string]> = [
    ["feedAllUsers", "feed:user:"],
    ["candidatesAll", "candidates:viewer:"],
    ["storiesAll", "stories:viewer:"],
  ];

  it.each(constRows)("cacheKeys.%s is %j", (name, expected) => {
    const value = (cacheKeys as unknown as Record<string, string>)[name];
    expect(value).toBe(expected);
  });

  it("every functional builder produces a namespaced, colon-delimited key", () => {
    expect(cacheKeys.feed("u", "c")).toContain(":");
    expect(cacheKeys.candidates("u")).toContain(":");
    expect(cacheKeys.post("p")).toContain(":");
    expect(cacheKeys.profile("u")).toContain(":");
    expect(cacheKeys.stories("u")).toContain(":");
    expect(cacheKeys.trending("r")).toContain(":");
    expect(cacheKeys.news("c")).toContain(":");
    expect(cacheKeys.explore("c", "u")).toContain(":");
    expect(cacheKeys.recommendations("u")).toContain(":");
    expect(cacheKeys.search("q")).toContain(":");
  });
});

// ---------------------------------------------------------------------------
// TTL — exact values
// ---------------------------------------------------------------------------

describe("TTL — exact second values", () => {
  const rows: Array<[keyof typeof TTL, number]> = [
    ["trending", 45],
    ["feed", 60],
    ["popular", 180],
    ["profile", 300],
    ["search", 120],
    ["news", 90],
    ["config", 86_400],
  ];

  it.each(rows)("TTL.%s === %i", (name, expected) => {
    expect(TTL[name]).toBe(expected);
  });

  it("no entry is cached forever: every TTL is finite and positive", () => {
    for (const value of Object.values(TTL)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(86_400);
    }
  });

  it("trending is the shortest-lived feed surface", () => {
    expect(TTL.trending).toBeLessThan(TTL.feed);
    expect(TTL.trending).toBeLessThan(TTL.popular);
    expect(TTL.trending).toBeLessThan(TTL.search);
  });

  it("config is the only day-long TTL", () => {
    const dayLong = Object.entries(TTL).filter(([, v]) => v >= 86_400);
    expect(dayLong).toEqual([["config", 86_400]]);
  });
});

// ---------------------------------------------------------------------------
// InMemoryCache
// ---------------------------------------------------------------------------

describe("InMemoryCache — read/write/delete", () => {
  const valueRows: Array<[string, unknown]> = [
    ["string", "value"],
    ["number", 42],
    ["zero", 0],
    ["false", false],
    ["true", true],
    ["empty-string", ""],
    ["null", null],
    ["object", { a: 1, nested: { b: [1, 2] } }],
    ["array", [1, "two", null]],
  ];

  it.each(valueRows)("stores and returns a %s value", async (_label, value) => {
    const cache = new InMemoryCache();
    await expect(cache.get("k")).resolves.toBeNull();
    await cache.set("k", value, 60);
    await expect(cache.get("k")).resolves.toEqual(value);
  });

  const missRows: string[] = ["missing", "", "a b", "🔥", "post:999", "feed:user:u:neutral:c"];

  it.each(missRows)("get(%j) misses on an empty cache", async (key) => {
    const cache = new InMemoryCache();
    await expect(cache.get(key)).resolves.toBeNull();
    expect(cache.misses).toBe(1);
    expect(cache.hits).toBe(0);
  });

  it.each(missRows)("get(%j) misses after an unrelated key was stored", async (key) => {
    const cache = new InMemoryCache();
    await cache.set("other", 1, 60);
    await expect(cache.get(key)).resolves.toBeNull();
  });

  const delRows: Array<[string[], string, string]> = [
    [["a"], "a", "b"],
    [["a", "b"], "a", "c"],
    [["post:1"], "post:1", "post:2"],
    [["x y"], "x y", "xy"],
  ];

  it.each(delRows)("del removes only %j", async (deletable, gone, kept) => {
    const cache = new InMemoryCache();
    await cache.set(gone, 1, 60);
    await cache.set(kept, 2, 60);
    for (const key of deletable) await cache.del(key);
    await expect(cache.get(gone)).resolves.toBeNull();
    await expect(cache.get(kept)).resolves.toBe(2);
  });

  it("del on a missing key is a no-op", async () => {
    const cache = new InMemoryCache();
    await cache.del("never-set");
    await cache.set("kept", 1, 60);
    await expect(cache.get("kept")).resolves.toBe(1);
  });

  const prefixRows: Array<[string, string[], string[]]> = [
    ["feed:user:a:", ["feed:user:a:1", "feed:user:a:2"], ["feed:user:b:1", "post:1"]],
    ["feed:user:", ["feed:user:a:1", "feed:user:b:1"], ["post:1", "profile:a"]],
    ["candidates:viewer:", ["candidates:viewer:v1"], ["feed:user:v1:1"]],
    ["stories:viewer:", ["stories:viewer:v1", "stories:viewer:v2"], ["stories:other:v1"]],
    ["post:", ["post:1", "post:2"], ["postX3", "feed:user:1:"]],
    ["", ["anything", "at:all"], []],
    ["search:", ["search:x"], ["searchy", "trending:x"]],
  ];

  it.each(prefixRows)("delPrefix(%j) drops %j and keeps %j", async (prefix, drops, keeps) => {
    const cache = new InMemoryCache();
    for (const key of [...drops, ...keeps]) await cache.set(key, key, 60);
    await cache.delPrefix(prefix);
    for (const key of drops) await expect(cache.get(key)).resolves.toBeNull();
    for (const key of keeps) await expect(cache.get(key)).resolves.toBe(key);
  });
});

describe("InMemoryCache — TTL expiry", () => {
  const expiryRows: Array<[number, number, boolean]> = [
    // [ttl seconds, advance ms, still alive?]
    [1, 999, true],
    [1, 1_001, false],
    [1, 5_000, false],
    [10, 7_000, true], // jitter floor is 80% of 10s
    [10, 13_000, false], // jitter ceiling is 120% of 10s
    [60, 47_000, true],
    [60, 73_000, false],
    [45, 35_000, true],
    [45, 55_000, false],
    [300, 239_000, true],
    [300, 361_000, false],
  ];

  it.each(expiryRows)("ttl=%is, + %ims -> alive=%s", async (ttl, advance, alive) => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const cache = new InMemoryCache();
    await cache.set("k", "v", ttl);
    vi.advanceTimersByTime(advance);
    if (alive) await expect(cache.get("k")).resolves.toBe("v");
    else await expect(cache.get("k")).resolves.toBeNull();
  });

  const zeroTtlRows: Array<[number, number, boolean]> = [
    [0, 500, true], // Math.max(1, ...) floors a 0s TTL to 1s
    [0, 1_500, false],
    [-5, 500, true], // negative TTLs are also floored to 1s
    [-5, 1_500, false],
  ];

  it.each(zeroTtlRows)("degenerate ttl=%s, + %ims -> alive=%s", async (ttl, advance, alive) => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const cache = new InMemoryCache();
    await cache.set("k", "v", ttl);
    vi.advanceTimersByTime(advance);
    if (alive) await expect(cache.get("k")).resolves.toBe("v");
    else await expect(cache.get("k")).resolves.toBeNull();
  });

  it("expired entries are dropped from the store, counting a miss", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const cache = new InMemoryCache();
    await cache.set("k", "v", 1);
    vi.advanceTimersByTime(2_000);
    await expect(cache.get("k")).resolves.toBeNull();
    expect(cache.misses).toBe(1);
    await expect(cache.get("k")).resolves.toBeNull();
    expect(cache.misses).toBe(2);
    expect(cache.hits).toBe(0);
  });

  it("a re-set key gets a fresh TTL window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const cache = new InMemoryCache();
    await cache.set("k", "v1", 1);
    vi.advanceTimersByTime(900);
    await cache.set("k", "v2", 10);
    vi.advanceTimersByTime(2_000);
    await expect(cache.get("k")).resolves.toBe("v2");
  });
});

describe("InMemoryCache — hit/miss counters", () => {
  const rows: Array<[string, number, number]> = [
    ["hit", 1, 0],
    ["hit", 2, 0],
    ["miss", 0, 1],
    ["miss", 0, 2],
    ["both", 1, 1],
  ];

  it.each(rows)("sequence %s -> hits>=%i misses>=%i", async (kind, minHits, minMisses) => {
    const cache = new InMemoryCache();
    await cache.set("k", "v", 60);
    if (kind === "hit" || kind === "both") await cache.get("k");
    if (kind === "miss" || kind === "both") await cache.get("absent");
    if (kind === "hit") await cache.get("k");
    if (kind === "miss") await cache.get("absent");
    expect(cache.hits).toBeGreaterThanOrEqual(minHits);
    expect(cache.misses).toBeGreaterThanOrEqual(minMisses);
    expect(cache.hits + cache.misses).toBeGreaterThanOrEqual(1);
  });

  it("counting twice on the same hit accumulates", async () => {
    const cache = new InMemoryCache();
    await cache.set("k", "v", 60);
    await cache.get("k");
    await cache.get("k");
    expect(cache.hits).toBe(2);
    expect(cache.misses).toBe(0);
  });
});

describe("InMemoryCache — LRU bound at 500 entries", () => {
  it("inserting entry 501 evicts the oldest key", async () => {
    const cache = new InMemoryCache();
    for (let i = 0; i < 500; i++) await cache.set(`k${i}`, i, 600);
    await cache.set("k500", 500, 600);
    await expect(cache.get("k500")).resolves.toBe(500);
    await expect(cache.get("k0")).resolves.toBeNull();
    await expect(cache.get("k1")).resolves.toBe(1);
  });

  it("reading a key protects it from the next eviction", async () => {
    const cache = new InMemoryCache();
    for (let i = 0; i < 500; i++) await cache.set(`k${i}`, i, 600);
    await cache.get("k0"); // touch -> moves to the newest end
    await cache.set("k500", 500, 600);
    await expect(cache.get("k0")).resolves.toBe(0);
    await expect(cache.get("k1")).resolves.toBeNull();
  });

  it("overwriting a key at capacity evicts nothing", async () => {
    const cache = new InMemoryCache();
    for (let i = 0; i < 500; i++) await cache.set(`k${i}`, i, 600);
    await cache.set("k250", "updated", 600);
    await expect(cache.get("k250")).resolves.toBe("updated");
    await expect(cache.get("k0")).resolves.toBe(0);
    await expect(cache.get("k499")).resolves.toBe(499);
  });

  it("expired entries are purged before live ones when the map is full", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const cache = new InMemoryCache();
    for (let i = 0; i < 500; i++) await cache.set(`stale${i}`, i, 1);
    vi.advanceTimersByTime(5_000);
    await cache.set("fresh", "kept", 600);
    await expect(cache.get("fresh")).resolves.toBe("kept");
    await expect(cache.get("stale0")).resolves.toBeNull();
    await expect(cache.get("stale499")).resolves.toBeNull();
  });
});

describe("InMemoryCache — incrBy", () => {
  const rows: Array<[number, number, number]> = [
    [1, 0, 1],
    [5, 3, 8],
    [10, -4, 6],
    [0, 7, 7],
    [-2, 2, 0],
    [100, 100, 200],
    [1.5, 0.5, 2],
  ];

  it.each(rows)("start %s incr %s -> %s", async (start, amount, expected) => {
    const cache = new InMemoryCache();
    if (start !== 0) await cache.set("counter", start, 60);
    await expect(cache.incrBy("counter", amount)).resolves.toBe(expected);
    await expect(cache.get("counter")).resolves.toBe(expected);
  });

  it("increments a missing counter from zero across calls", async () => {
    const cache = new InMemoryCache();
    await expect(cache.incrBy("c", 3)).resolves.toBe(3);
    await expect(cache.incrBy("c", 4)).resolves.toBe(7);
    await expect(cache.get("c")).resolves.toBe(7);
  });

  it("a count written by incrBy survives the popular TTL but not beyond it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const cache = new InMemoryCache();
    await cache.incrBy("c", 1);
    vi.advanceTimersByTime(100_000);
    await expect(cache.get("c")).resolves.toBe(1);
    vi.advanceTimersByTime(200_000);
    await expect(cache.get("c")).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// VersionedCache
// ---------------------------------------------------------------------------

describe("VersionedCache — epoch-versioned keys", () => {
  const namespaces: Array<[string, string]> = [
    ["feed:user:a:neutral:c1", "v1"],
    ["post:p1", "p"],
    ["profile:u1", "prof"],
    ["trending:global", "tr"],
    ["search:q", "q"],
    ["news:general", "n"],
    ["candidates:viewer:v", "c"],
    ["stories:viewer:v", "s"],
    ["explore:music:c", "e"],
    ["recommendations:u", "r"],
    ["a", "no-colon"],
    ["plainkey", "x"],
  ];

  it.each(namespaces)("key %j round-trips before any invalidation", async (key, value) => {
    const cache = new VersionedCache(new InMemoryCache());
    await cache.set(key, value, 60);
    await expect(cache.get(key)).resolves.toBe(value);
  });

  it.each(namespaces)("key %j dies for everyone after delPrefix", async (key) => {
    const inner = new InMemoryCache();
    const cache = new VersionedCache(inner);
    await cache.set(key, "old", 60);
    await cache.delPrefix(key);
    await expect(cache.get(key)).resolves.toBeNull();
  });

  it("namespace siblings stay physically stored but become unreachable", async () => {
    const inner = new InMemoryCache();
    const cache = new VersionedCache(inner);
    await cache.set("post:p1", "v1", 60);
    await cache.set("post:p2", "v2", 60);
    // Versions the whole top-level "post" namespace; the literal prefix delete
    // only touches keys under "post:p1".
    await cache.delPrefix("post:p1");
    await expect(cache.get("post:p1")).resolves.toBeNull();
    await expect(cache.get("post:p2")).resolves.toBeNull();
    await expect(inner.get("post:p2")).resolves.toBe("v2");
    await expect(inner.get("post:p1")).resolves.toBeNull();
  });

  const invalidationRows: Array<[string, string, string]> = [
    ["feed:user:a:1", "post:1", "feed:user:"],
    ["feed:user:a:1", "profile:u2", "feed:user:"],
    ["candidates:viewer:v1", "post:2", "candidates:viewer:"],
    ["stories:viewer:v1", "trending:eu", "stories:viewer:"],
    ["trending:global", "news:sports", "trending:"],
    ["news:general", "search:q", "news:"],
    ["profile:u1", "post:p3", "profile:"],
    ["search:q1", "post:p4", "search:"],
    ["post:p1", "profile:u9", "post:"],
    ["a:b", "c:d", "a:"],
    ["plain", "other", "plain"],
    ["explore:music:c", "recommendations:u", "explore:"],
    ["recommendations:u", "stories:viewer:z", "recommendations:"],
  ];

  it.each(invalidationRows)(
    "delPrefix(%j) invalidates %j but leaves %j alone",
    async (victim, survivor, prefix) => {
      const cache = new VersionedCache(new InMemoryCache());
      await cache.set(victim, "old", 60);
      await cache.set(survivor, "kept", 60);
      await cache.delPrefix(prefix);
      await expect(cache.get(victim)).resolves.toBeNull();
      await expect(cache.get(survivor)).resolves.toBe("kept");
    },
  );

  it("epoch survives in a fresh wrapper over the same inner cache", async () => {
    const inner = new InMemoryCache();
    const first = new VersionedCache(inner);
    await first.set("post:p1", "v1", 60);
    await first.delPrefix("post:");
    await first.set("post:p1", "v2", 60);

    const second = new VersionedCache(inner);
    await expect(second.get("post:p1")).resolves.toBe("v2");
    await second.delPrefix("post:");
    await expect(second.get("post:p1")).resolves.toBeNull();
    await expect(first.get("post:p1")).resolves.toBeNull();
  });

  it("counter state is orphaned by invalidation", async () => {
    const cache = new VersionedCache(new InMemoryCache());
    await cache.incrBy("post:p1", 5);
    await cache.incrBy("post:p1", 2);
    await expect(cache.get("post:p1")).resolves.toBe(7);
    await cache.delPrefix("post:");
    await expect(cache.get("post:p1")).resolves.toBeNull();
    await expect(cache.incrBy("post:p1", 1)).resolves.toBe(1);
  });

  it("__epoch__ keys pass through unversioned", async () => {
    const cache = new VersionedCache(new InMemoryCache());
    await cache.set("__epoch__:post", 7, 60);
    await expect(cache.get("__epoch__:post")).resolves.toBe(7);
    await cache.del("__epoch__:post");
    await expect(cache.get("__epoch__:post")).resolves.toBeNull();
  });

  it("deletes a single versioned key without touching siblings", async () => {
    const cache = new VersionedCache(new InMemoryCache());
    await cache.set("post:p1", 1, 60);
    await cache.set("post:p2", 2, 60);
    await cache.del("post:p1");
    await expect(cache.get("post:p1")).resolves.toBeNull();
    await expect(cache.get("post:p2")).resolves.toBe(2);
  });

  const delPrefixTopRows: Array<[string, string]> = [
    ["feed:user:a:", "feed"],
    ["candidates:viewer:", "candidates"],
    ["stories:viewer:", "stories"],
    ["trending:", "trending"],
    ["news:", "news"],
    ["profile:", "profile"],
    ["search:", "search"],
    ["post:", "post"],
    ["explore:", "explore"],
    ["recommendations:", "recommendations"],
  ];

  it.each(delPrefixTopRows)("delPrefix(%j) versions the %j namespace", async (prefix, top) => {
    const inner = new InMemoryCache();
    const cache = new VersionedCache(inner);
    await cache.set(`${top}:payload`, "v", 60);
    await cache.delPrefix(prefix);
    await expect(cache.get(`${top}:payload`)).resolves.toBeNull();
    await expect(inner.get(`__epoch__:${top}`)).resolves.toBe(1);
  });
});

// ---------------------------------------------------------------------------
// cacheAside + invalidate (module-level client, memory backend)
// ---------------------------------------------------------------------------

describe("cacheAside — miss, load, hit", () => {
  const valueRows: Array<[string, unknown]> = [
    ["string", "payload"],
    ["number", 42],
    ["zero", 0],
    ["false", false],
    ["empty", ""],
    ["object", { id: "1", items: [1, 2] }],
    ["array", [1, 2, 3]],
    ["undefined", undefined],
  ];

  it.each(valueRows)("caches a %s value after the first load", async (label, value) => {
    const key = `aside:${label}`;
    const loader = vi.fn(async () => value);
    await expect(cacheAside(key, 60, loader)).resolves.toEqual(value);
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(cacheAside(key, 60, loader)).resolves.toEqual(value);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("a null value is treated as a miss every time", async () => {
    const loader = vi.fn(async () => null);
    await expect(cacheAside("aside:null", 60, loader)).resolves.toBeNull();
    await expect(cacheAside("aside:null", 60, loader)).resolves.toBeNull();
    await expect(cacheAside("aside:null", 60, loader)).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it("different keys never share a cached value", async () => {
    const a = vi.fn(async () => "A");
    const b = vi.fn(async () => "B");
    await expect(cacheAside("aside:a", 60, a)).resolves.toBe("A");
    await expect(cacheAside("aside:b", 60, b)).resolves.toBe("B");
    await expect(cacheAside("aside:a", 60, a)).resolves.toBe("A");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("propagates loader errors and caches nothing", async () => {
    const loader = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(cacheAside("aside:err", 60, loader)).rejects.toThrow("boom");
    const ok = vi.fn(async () => "recovered");
    await expect(cacheAside("aside:err", 60, ok)).resolves.toBe("recovered");
    expect(ok).toHaveBeenCalledTimes(1);
  });

  const ttlRows: Array<[number, number, number]> = [
    // [ttl, advance ms, loader runs again?]
    [60, 47_000, 0],
    [60, 73_000, 1],
    [45, 35_000, 0],
    [45, 55_000, 1],
    [1, 500, 0],
    [1, 1_500, 1],
  ];

  it.each(ttlRows)("ttl=%is: + %ims -> extra loads=%i", async (ttl, advance, extraLoads) => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const key = `aside:ttl:${ttl}`;
    const first = vi.fn(async () => "v1");
    await expect(cacheAside(key, ttl, first)).resolves.toBe("v1");
    vi.advanceTimersByTime(advance);
    const second = vi.fn(async () => "v2");
    const result = await cacheAside(key, ttl, second);
    if (extraLoads === 0) {
      expect(second).not.toHaveBeenCalled();
      expect(result).toBe("v1");
    } else {
      expect(second).toHaveBeenCalledTimes(1);
      expect(result).toBe("v2");
    }
  });

  it("a fresh key is always loaded exactly once per TTL window", async () => {
    const loader = vi.fn(async () => ({ fresh: true }));
    await expect(cacheAside("aside:fresh", 60, loader)).resolves.toEqual({ fresh: true });
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(cacheAside("aside:fresh", 60, loader)).resolves.toEqual({ fresh: true });
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("invalidate — targeted key deletion", () => {
  type SingleOp = "post" | "profile" | "trending";
  const singleRows: Array<[SingleOp, string, string]> = [
    ["post", "p-single-1", "post:p-single-1"],
    ["post", "11111111-1111-1111-1111-111111111111", "post:11111111-1111-1111-1111-111111111111"],
    ["profile", "profile-single-1", "profile:profile-single-1"],
    ["trending", "trending-single-1", "trending:trending-single-1"],
    ["trending", "TZ-single", "trending:TZ-single"],
  ];

  it.each(singleRows)("invalidate.%s(%j) reloads %j", async (op, arg, key) => {
    const warm = vi.fn(async () => "warm");
    await expect(cacheAside(key, 60, warm)).resolves.toBe("warm");
    expect(warm).toHaveBeenCalledTimes(1);

    await invalidate[op](arg);

    const cold = vi.fn(async () => "cold");
    await expect(cacheAside(key, 60, cold)).resolves.toBe("cold");
    expect(cold).toHaveBeenCalledTimes(1);
    expect(warm).toHaveBeenCalledTimes(1);
  });

  const surviveRows: Array<[SingleOp, string, string[]]> = [
    [
      "post",
      "p-surv-1",
      ["post:p-surv-other", "profile:u-surv", "trending:tr-surv", "search:q-surv"],
    ],
    [
      "profile",
      "profile-surv-1",
      ["profile:profile-surv-other", "post:pp-surv", "trending:tr2-surv", "search:q2-surv"],
    ],
    [
      "trending",
      "trending-surv-1",
      ["trending:trending-other", "post:pt-surv", "profile:pf-surv", "search:q3-surv"],
    ],
  ];

  it.each(surviveRows)("invalidate.%s(%j) leaves %j cached", async (op, arg, others) => {
    const loaders = new Map<string, ReturnType<typeof vi.fn>>();
    for (const key of others) {
      const loader = vi.fn(async () => key);
      loaders.set(key, loader);
      await cacheAside(key, 60, loader);
    }
    await invalidate[op](arg);
    for (const key of others) {
      await expect(cacheAside(key, 60, loaders.get(key)!)).resolves.toBe(key);
      expect(loaders.get(key)).toHaveBeenCalledTimes(1);
    }
  });

  type PrefixOp = "feed" | "feedAll" | "candidates" | "stories";
  const prefixRows: Array<[PrefixOp, string[], string[]]> = [
    [
      "feed",
      ["feed:user:fu-a:neutral:c1", "feed:user:fu-a:fast:c2", "feed:user:fu-b:neutral:c1"],
      ["post:post-px1", "profile:profile-px1", "search:search-px1"],
    ],
    [
      "feedAll",
      ["feed:user:fu-c:neutral:c1", "feed:user:fu-d:neutral:c1"],
      ["candidates:viewer:cand-ka1"],
    ],
    [
      "candidates",
      ["candidates:viewer:cand-cv1", "candidates:viewer:cand-cv2"],
      ["feed:user:fu-e:neutral:c1"],
    ],
    [
      "stories",
      ["stories:viewer:sto-sv1", "stories:viewer:sto-sv2"],
      ["candidates:viewer:cand-ck1"],
    ],
    [
      "stories",
      ["stories:viewer:sto-sv3"],
      [
        "post:post-pk1",
        "profile:profile-pr1",
        "trending:trending-tg1",
        "news:news-nw1",
        "search:search-se1",
      ],
    ],
  ];

  it.each(prefixRows)("invalidate.%s() drops %j and keeps %j", async (op, drops, keeps) => {
    const dropLoaders = new Map<string, ReturnType<typeof vi.fn>>();
    for (const key of drops) {
      const loader = vi.fn(async () => "warm");
      dropLoaders.set(key, loader);
      await cacheAside(key, 60, loader);
    }
    const keepLoaders = new Map<string, ReturnType<typeof vi.fn>>();
    for (const key of keeps) {
      const loader = vi.fn(async () => "warm");
      keepLoaders.set(key, loader);
      await cacheAside(key, 60, loader);
    }

    const noArgInvalidate = invalidate as unknown as Record<string, () => Promise<void>>;
    expect(typeof noArgInvalidate[op]).toBe("function");
    await noArgInvalidate[op]?.();

    for (const key of drops) {
      const fresh = vi.fn(async () => "fresh");
      await expect(cacheAside(key, 60, fresh)).resolves.toBe("fresh");
      expect(fresh).toHaveBeenCalledTimes(1);
      expect(dropLoaders.get(key)).toHaveBeenCalledTimes(1);
    }
    for (const key of keeps) {
      await expect(cacheAside(key, 60, keepLoaders.get(key)!)).resolves.toBe("warm");
      expect(keepLoaders.get(key)).toHaveBeenCalledTimes(1);
    }
  });
});

describe("cacheStats / cacheBackend (memory backend)", () => {
  it("reports the memory backend with live counters", async () => {
    const before = cacheStats();
    expect(before.backend).toBe("memory");
    expect(typeof before.hits).toBe("number");
    expect(typeof before.misses).toBe("number");

    const key = "stats:probe";
    await cacheAside(key, 60, async () => "v"); // 1 miss + 1 hit later
    const cold = vi.fn(async () => "v2");
    await cacheAside(key, 60, cold);
    expect(cold).not.toHaveBeenCalled();

    const after = cacheStats();
    expect(after.backend).toBe("memory");
    // Cold read: one miss for the namespace epoch probe + one for the value.
    // Warm read: one hit for the value (the epoch is memoised per wrapper).
    expect(after.hits).toBe((before.hits ?? 0) + 1);
    expect(after.misses).toBe((before.misses ?? 0) + 2);
  });

  it("cacheBackend() stays stable across calls", () => {
    expect(cacheBackend()).toBe("memory");
    expect(cacheBackend()).toBe("memory");
  });
});
