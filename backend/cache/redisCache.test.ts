import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCache, VersionedCache } from "./redisCache";

afterEach(() => {
  vi.useRealTimers();
});

describe("InMemoryCache", () => {
  it("returns null on miss and caches hits", async () => {
    const cache = new InMemoryCache();
    const loader = vi.fn().mockResolvedValue("value");
    await expect(cache.get("missing")).resolves.toBeNull();
    await cache.set("k", "value", 60);
    await expect(cache.get("k")).resolves.toBe("value");
    expect(loader).not.toHaveBeenCalled();
  });

  it("expires entries after the TTL", async () => {
    vi.useFakeTimers();
    try {
      const cache = new InMemoryCache();
      await cache.set("k", "value", 60);
      await expect(cache.get("k")).resolves.toBe("value");
      vi.advanceTimersByTime(75_000);
      await expect(cache.get("k")).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds the map with LRU eviction", async () => {
    const cache = new InMemoryCache();
    for (let i = 0; i < 600; i++) await cache.set(`k${i}`, i, 600);
    // The oldest entries are evicted; recent ones survive.
    await expect(cache.get("k599")).resolves.toBe(599);
    await expect(cache.get("k0")).resolves.toBeNull();
  });

  it("delPrefix removes only matching keys", async () => {
    const cache = new InMemoryCache();
    await cache.set("feed:user:a:1", 1, 60);
    await cache.set("feed:user:b:1", 2, 60);
    await cache.set("post:1", 3, 60);
    await cache.delPrefix("feed:user:a:");
    await expect(cache.get("feed:user:a:1")).resolves.toBeNull();
    await expect(cache.get("feed:user:b:1")).resolves.toBe(2);
    await expect(cache.get("post:1")).resolves.toBe(3);
  });
});

describe("VersionedCache", () => {
  it("serves versioned keys and invalidates a whole namespace on delPrefix", async () => {
    const inner = new InMemoryCache();
    const cache = new VersionedCache(inner);
    await cache.set("feed:user:a:1", "v1", 60);
    await expect(cache.get("feed:user:a:1")).resolves.toBe("v1");

    await cache.delPrefix("feed:user:a:");
    // Same logical key, new namespace version → miss.
    await expect(cache.get("feed:user:a:1")).resolves.toBeNull();

    await cache.set("feed:user:a:1", "v2", 60);
    await expect(cache.get("feed:user:a:1")).resolves.toBe("v2");
  });

  it("keeps other namespaces untouched by delPrefix", async () => {
    const inner = new InMemoryCache();
    const cache = new VersionedCache(inner);
    await cache.set("feed:user:a:1", "v1", 60);
    await cache.set("post:1", "p1", 60);
    await cache.delPrefix("feed:user:");
    await expect(cache.get("post:1")).resolves.toBe("p1");
  });
});
