/**
 * Cache layer (Redis contract).
 *
 * Two backends behind one interface:
 *  - Upstash Redis (REST, no extra deps) when UPSTASH_REDIS_REST_URL +
 *    UPSTASH_REDIS_REST_TOKEN are set — shared across server instances.
 *  - In-process map otherwise, so the app runs with zero infra.
 *
 * Reads go cache-aside with intentional TTLs; writes never go through the
 * cache — publishers call the invalidate helpers instead (see
 * `invalidateHomeCache` in api/home.functions.ts).
 */

export interface CacheClient {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  incrBy(key: string, amount: number): Promise<number>;
}

/** Intentional TTLs — nothing is cached permanently. */
export const TTL = {
  trending: 45,
  feed: 60,
  popular: 180,
  profile: 300,
  search: 120,
  news: 90,
  config: 86_400,
} as const;

/** Canonical key builders. Keep every key namespaced and prefix-invalidatable. */
export const cacheKeys = {
  feed: (userId: string, cursor: string, profileKey = "neutral") =>
    `feed:user:${userId}:${profileKey}:${cursor}`,
  feedAll: (userId: string) => `feed:user:${userId}:`,
  feedAllUsers: "feed:user:",
  candidates: (viewerId: string) => `candidates:viewer:${viewerId}`,
  candidatesAll: "candidates:viewer:",
  post: (postId: string) => `post:${postId}`,
  profile: (userId: string) => `profile:${userId}`,
  stories: (viewerId: string) => `stories:viewer:${viewerId}`,
  storiesAll: "stories:viewer:",
  trending: (region: string) => `trending:${region}`,
  news: (category: string) => `news:${category}`,
  explore: (category: string, cursor: string) => `explore:${category}:${cursor}`,
  recommendations: (userId: string) => `recommendations:${userId}`,
  search: (query: string) => `search:${query}`,
};

interface Entry {
  value: unknown;
  expiresAt: number;
  /** Insertion order marker for LRU eviction when the map is full. */
  touchedAt: number;
}

const MEMORY_MAX_ENTRIES = 500;

/** ±20% TTL jitter so many keys written together don't expire as a herd. */
function jittered(ttlSeconds: number): number {
  return Math.max(1, Math.round(ttlSeconds * (0.8 + Math.random() * 0.4)));
}

export class InMemoryCache implements CacheClient {
  private store = new Map<string, Entry>();
  hits = 0;
  misses = 0;

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      if (entry) this.store.delete(key);
      this.misses += 1;
      return null;
    }
    // LRU touch for insertion-order eviction.
    entry.touchedAt = Date.now();
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (this.store.size >= MEMORY_MAX_ENTRIES && !this.store.has(key)) {
      const now = Date.now();
      for (const [k, e] of [...this.store]) {
        if (e.expiresAt < now) this.store.delete(k);
      }
      while (this.store.size >= MEMORY_MAX_ENTRIES) {
        const oldest = this.store.keys().next().value;
        if (oldest === undefined) break;
        this.store.delete(oldest);
      }
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + jittered(ttlSeconds) * 1000,
      touchedAt: Date.now(),
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async delPrefix(prefix: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  async incrBy(key: string, amount: number): Promise<number> {
    const current = (await this.get<number>(key)) ?? 0;
    const next = current + amount;
    await this.set(key, next, TTL.popular);
    return next;
  }
}

/** Upstash Redis over plain fetch (REST pipeline). Zero new dependencies. */
class UpstashCache implements CacheClient {
  constructor(
    private url: string,
    private token: string,
  ) {}

  private async call<T>(...command: (string | number)[]): Promise<T> {
    const res = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify([command]),
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    const json = (await res.json()) as { result?: T }[];
    return json[0]?.result as T;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.call<string | null>("GET", key).catch(() => null);
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.call("SET", key, JSON.stringify(value), "EX", jittered(ttlSeconds)).catch(
      () => undefined,
    );
  }

  async del(key: string): Promise<void> {
    await this.call("DEL", key).catch(() => undefined);
  }

  async incrBy(key: string, amount: number): Promise<number> {
    const next = await this.call<number>("INCRBY", key, amount).catch(() => NaN);
    if (Number.isFinite(next)) {
      await this.call("EXPIRE", key, TTL.popular).catch(() => undefined);
      return next;
    }
    return amount;
  }
}

const memory = new InMemoryCache();
let shared: VersionedCache | null = null;
let backend: "memory" | "upstash" = "memory";

/**
 * Versioned key namespace. Prefix invalidation bumps a per-namespace epoch
 * stored in the cache itself (shared across instances) instead of SCAN+DEL,
 * so a stale read can never resurrect an invalidated key.
 */
export class VersionedCache implements CacheClient {
  private epochs = new Map<string, number>();

  constructor(private inner: CacheClient) {}

  private topNs(key: string): string {
    const i = key.indexOf(":");
    return i > 0 ? key.slice(0, i) : key;
  }

  private async resolve(key: string): Promise<string> {
    if (key.startsWith("__epoch__:")) return key;
    const top = this.topNs(key);
    const cached = this.epochs.get(top);
    const epoch = cached ?? (await this.inner.get<number>(`__epoch__:${top}`)) ?? 0;
    this.epochs.set(top, epoch);
    if (epoch === 0) return key;
    const i = key.indexOf(":");
    const rest = i > 0 ? key.slice(i + 1) : "";
    return `${top}:~v${epoch}~:${rest}`;
  }

  async get<T>(key: string): Promise<T | null> {
    return this.inner.get<T>(await this.resolve(key));
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.inner.set(await this.resolve(key), value, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.inner.del(await this.resolve(key));
  }

  async delPrefix(prefix: string): Promise<void> {
    const top = this.topNs(prefix);
    const next = ((await this.inner.get<number>(`__epoch__:${top}`)) ?? 0) + 1;
    await this.inner.set(`__epoch__:${top}`, next, TTL.config);
    this.epochs.set(top, next);
    // Free memory for the old literal keys when the backend is in-process.
    if (this.inner instanceof InMemoryCache) await this.inner.delPrefix(prefix);
  }

  async incrBy(key: string, amount: number): Promise<number> {
    return this.inner.incrBy(await this.resolve(key), amount);
  }
}

function client(): VersionedCache {
  if (shared) return shared;
  const url = process.env["UPSTASH_REDIS_REST_URL"];
  const token = process.env["UPSTASH_REDIS_REST_TOKEN"];
  if (url && token) {
    backend = "upstash";
    shared = new VersionedCache(new UpstashCache(url, token));
  } else {
    shared = new VersionedCache(memory);
  }
  return shared;
}

/** Which backend is active — surfaced in Admin → System health. */
export function cacheBackend(): "memory" | "upstash" {
  client();
  return backend;
}

/** Hit/miss counters (memory backend only; Redis tracks its own). */
export function cacheStats(): {
  backend: "memory" | "upstash";
  hits: number | null;
  misses: number | null;
} {
  client();
  if (backend === "memory") return { backend, hits: memory.hits, misses: memory.misses };
  return { backend, hits: null, misses: null };
}

/** Cache-aside read. Miss -> loader -> SETEX -> response. */
export async function cacheAside<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const c = client();
  try {
    const cached = await c.get<T>(key);
    if (cached !== null) return cached;
  } catch {
    // cache failure must never break the request — fall through to loader
  }
  const fresh = await loader();
  try {
    await c.set(key, fresh, ttlSeconds);
  } catch {
    // ignore write failures
  }
  return fresh;
}

/** Targeted invalidation. Never flush the whole keyspace. */
export const invalidate = {
  post: (postId: string) => client().del(cacheKeys.post(postId)),
  profile: (userId: string) => client().del(cacheKeys.profile(userId)),
  stories: () => client().delPrefix(cacheKeys.storiesAll),
  feed: (userId: string) => client().delPrefix(cacheKeys.feedAll(userId)),
  feedAll: () => client().delPrefix(cacheKeys.feedAllUsers),
  candidates: () => client().delPrefix(cacheKeys.candidatesAll),
  trending: (region: string) => client().del(cacheKeys.trending(region)),
};
