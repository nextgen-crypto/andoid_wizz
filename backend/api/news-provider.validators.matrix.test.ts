import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Table-driven matrix for backend/api/news-provider.functions.ts.
 *
 * The module's `validateNewsRequest` is module-private, so the TanStack
 * createServerFn harness is mocked to expose the registered validator as
 * `_validator` — the same pattern the existing ads/events suites use. The
 * GNews service is mocked (no network) and `cacheAside` is replaced by a
 * recording stub that delegates to the loader, while `TTL` is the REAL value
 * from the cache module (importActual) so the TTL assertion pins production.
 */

const fetchGNewsMock = vi.fn(async (): Promise<unknown[]> => []);
const isGNewsConfiguredMock = vi.fn(() => false);
const cacheAsideMock = vi.fn(
  async <T>(_key: string, _ttl: number, loader: () => Promise<T>): Promise<T> => loader(),
);

vi.mock("../services/gnewsService", () => ({
  fetchGNews: fetchGNewsMock,
  isGNewsConfigured: isGNewsConfiguredMock,
}));

vi.mock("../cache/redisCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cache/redisCache")>();
  return { ...actual, cacheAside: cacheAsideMock };
});

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tanstack/react-start")>();
  interface ServerFnBuilder {
    _validator: ((data: unknown) => unknown) | null;
    validator(validator: (data: unknown) => unknown): ServerFnBuilder;
    handler(
      fn: (args: { data: unknown }) => unknown,
    ): ((opts?: { data?: unknown }) => Promise<unknown>) & { _validator: unknown };
  }
  const createServerFn = (): ServerFnBuilder => {
    const builder: ServerFnBuilder = {
      _validator: null,
      validator(validator) {
        builder._validator = validator;
        return builder;
      },
      handler(fn) {
        const callable = async ({ data }: { data?: unknown } = {}) => {
          const validated = builder._validator ? builder._validator(data) : data;
          return fn({ data: validated });
        };
        (callable as { _validator?: unknown })._validator = builder._validator;
        return callable as ((opts?: { data?: unknown }) => Promise<unknown>) & {
          _validator: unknown;
        };
      },
    };
    return builder;
  };
  return { ...original, createServerFn };
});

const { fetchExternalNews } = await import("./news-provider.functions");
const { TTL } = await import("../cache/redisCache");

const validate = (fetchExternalNews as unknown as { _validator: (data: unknown) => unknown })
  ._validator as (data: unknown) => Record<string, unknown>;

const invoke = fetchExternalNews as unknown as (opts?: {
  data?: unknown;
}) => Promise<unknown> as (opts?: {
  data?: unknown;
}) => Promise<{ articles: unknown[]; configured: boolean; fetchedAt: string }>;

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// validateNewsRequest — category
// ---------------------------------------------------------------------------

describe("validator: category normalization", () => {
  const allowed = [
    "general",
    "world",
    "nation",
    "business",
    "technology",
    "entertainment",
    "sports",
    "science",
    "health",
  ];

  const categoryRows: Array<[label: string, input: string, expected: string]> = [
    ...allowed.map((c) => [`${c} passes through`, c, c] as [string, string, string]),
    ...allowed.map(
      (c) => [`${c.toUpperCase()} lowercases`, c.toUpperCase(), c] as [string, string, string],
    ),
    ["undefined defaults to general", undefined as unknown as string, "general"],
    ["null defaults to general", null as unknown as string, "general"],
    ["an empty string defaults to general", "", "general"],
    ["an unknown category defaults to general", "politics", "general"],
    ["a padded category defaults to general", " technology ", "general"],
    ["a partial match defaults to general", "tech", "general"],
    ["a near-miss with punctuation defaults to general", "sports!", "general"],
  ];

  it.each(categoryRows)("category=%j -> %j", (_label, input, expected) => {
    expect(validate({ category: input })["category"]).toBe(expected);
  });

  // The `?.` in `data?.category?.toLowerCase()` only guards null/undefined —
  // any other non-string reaches `.toLowerCase()` and throws. Pin that.
  const throwingRows: Array<[label: string, input: unknown]> = [
    ["a number", 42],
    ["zero", 0],
    ["a boolean", true],
    ["an array", ["sports"]],
    ["an object", { toString: () => "sports" }],
  ];

  it.each(throwingRows)("a %s category throws a TypeError", (_label, input) => {
    expect(() => validate({ category: input })).toThrow(TypeError);
  });

  it("validator(undefined) produces the full default options object", () => {
    expect(validate(undefined)).toEqual({ category: "general", country: "tz", lang: "en" });
  });

  it("an empty options object produces the same defaults as undefined", () => {
    expect(validate({})).toEqual(validate(undefined));
  });
});

// ---------------------------------------------------------------------------
// validateNewsRequest — query
// ---------------------------------------------------------------------------

describe("validator: query handling", () => {
  const queryRows: Array<[label: string, input: unknown, expected: string | undefined]> = [
    ["a plain query", "ai", "ai"],
    ["a padded query is trimmed", "  ai  ", "ai"],
    ["a multi-word query keeps internal spaces", "climate change", "climate change"],
    ["a single character", "x", "x"],
    ["an empty query is dropped", "", undefined],
    ["a whitespace-only query is dropped", "   ", undefined],
    ["a tab-only query is dropped", "\t", undefined],
    ["a newline-padded query is trimmed", "\n ai \n", "ai"],
    ["199 chars pass through", "a".repeat(199), "a".repeat(199)],
    ["exactly 200 chars pass through", "a".repeat(200), "a".repeat(200)],
    ["201 chars are sliced to 200", "a".repeat(201), "a".repeat(200)],
    ["1000 chars are sliced to 200", "a".repeat(1_000), "a".repeat(200)],
    ["padding plus 250 chars slices to 200 trimmed chars", ` ${"b".repeat(250)} `, "b".repeat(200)],
    ["undefined is dropped", undefined, undefined],
    ["a number is dropped", 123, undefined],
    ["a boolean is dropped", false, undefined],
    ["null is dropped", null, undefined],
    ["an array is dropped", ["ai"], undefined],
  ];

  it.each(queryRows)("query=%j -> %j", (_label, input, expected) => {
    const result = validate({ query: input });
    if (expected === undefined) expect("query" in result).toBe(false);
    else expect(result["query"]).toBe(expected);
  });

  it("a query suppresses no other field (category/country/lang stay defaulted)", () => {
    expect(validate({ query: "ai" })).toEqual({
      category: "general",
      country: "tz",
      lang: "en",
      query: "ai",
    });
  });
});

// ---------------------------------------------------------------------------
// validateNewsRequest — country / lang / page
// ---------------------------------------------------------------------------

describe("validator: country and lang", () => {
  const countryRows: Array<[input: unknown, expected: string]> = [
    [undefined, "tz"],
    ["us", "us"],
    ["ng", "ng"],
    ["TZ", "TZ"],
    ["", ""],
    ["tz", "tz"],
  ];

  it.each(countryRows)("country=%j -> %j", (input, expected) => {
    expect(validate({ country: input })["country"]).toBe(expected);
  });

  const langRows: Array<[input: unknown, expected: string]> = [
    [undefined, "en"],
    ["fr", "fr"],
    ["es", "es"],
    ["sw", "sw"],
    ["", ""],
  ];

  it.each(langRows)("lang=%j -> %j", (input, expected) => {
    expect(validate({ lang: input })["lang"]).toBe(expected);
  });

  it("null country falls back to tz", () => {
    expect(validate({ country: null })["country"]).toBe("tz");
  });

  it("null lang falls back to en", () => {
    expect(validate({ lang: null })["lang"]).toBe("en");
  });
});

describe("validator: page", () => {
  const pageRows: Array<[label: string, input: unknown, present: boolean, expected: number]> = [
    ["undefined is omitted", undefined, false, 0],
    ["zero is omitted (falsy)", 0, false, 0],
    ["NaN is omitted (falsy)", Number.NaN, false, 0],
    ["1 is kept", 1, true, 1],
    ["3 is kept", 3, true, 3],
    ["-2 is kept (truthy, clamping happens upstream)", -2, true, -2],
    ["2.5 is kept unrounded", 2.5, true, 2.5],
  ];

  it.each(pageRows)("page=%s", (_label, input, present, expected) => {
    const result = validate({ page: input });
    if (present) expect(result["page"]).toBe(expected);
    else expect("page" in result).toBe(false);
  });

  it("a string page is kept as-is (no coercion in the validator)", () => {
    expect(validate({ page: "7" as unknown as number })["page"]).toBe("7");
  });
});

// ---------------------------------------------------------------------------
// validateNewsRequest — combined shapes
// ---------------------------------------------------------------------------

describe("validator: combined option shapes", () => {
  const combinedRows: Array<[label: string, input: unknown, expected: Record<string, unknown>]> = [
    [
      "a full valid request",
      { category: "Sports", query: " derby ", country: "ke", lang: "sw", page: 2 },
      { category: "sports", query: "derby", country: "ke", lang: "sw", page: 2 },
    ],
    [
      "an invalid category with a query",
      { category: "bogus", query: "ai" },
      { category: "general", country: "tz", lang: "en", query: "ai" },
    ],
    [
      "page without query",
      { page: 5 },
      { category: "general", country: "tz", lang: "en", page: 5 },
    ],
    [
      "country and lang only",
      { country: "ng", lang: "fr" },
      { category: "general", country: "ng", lang: "fr" },
    ],
    [
      "every field with an invalid category",
      { category: "nope", query: "q", country: "za", lang: "de", page: 9 },
      { category: "general", country: "za", lang: "de", page: 9, query: "q" },
    ],
    [
      "query longer than 200 with padding",
      { query: `  ${"z".repeat(300)}  ` },
      { category: "general", country: "tz", lang: "en", query: "z".repeat(200) },
    ],
  ];

  it.each(combinedRows)("%s", (_label, input, expected) => {
    expect(validate(input)).toEqual(expected);
  });

  it("never emits a category outside the allowed set for string inputs", () => {
    const inputs = ["general", "WORLD", "nope", "", " nation ", undefined];
    for (const category of inputs) {
      expect(["general", "world", "nation"]).toContain(validate({ category })["category"]);
    }
  });
});

// ---------------------------------------------------------------------------
// handler — cache key construction and delegation
// ---------------------------------------------------------------------------

describe("handler: cache key construction", () => {
  const keyRows: Array<[label: string, input: unknown, expectedKey: string]> = [
    ["defaults", undefined, "gnews:general:tz:en:1:"],
    ["an empty object", {}, "gnews:general:tz:en:1:"],
    ["a category", { category: "TECHNOLOGY" }, "gnews:technology:tz:en:1:"],
    ["a country", { country: "ke" }, "gnews:general:ke:en:1:"],
    ["a lang", { lang: "fr" }, "gnews:general:tz:fr:1:"],
    ["a page", { page: 4 }, "gnews:general:tz:en:4:"],
    ["page zero falls back to 1", { page: 0 }, "gnews:general:tz:en:1:"],
    ["a query", { query: "ai" }, "gnews:general:tz:en:1:ai"],
    ["a padded query is keyed trimmed", { query: "  ai  " }, "gnews:general:tz:en:1:ai"],
    [
      "everything",
      { category: "sports", country: "ke", lang: "sw", page: 3, query: " derby " },
      "gnews:sports:ke:sw:3:derby",
    ],
    ["an invalid category keys as general", { category: "bogus" }, "gnews:general:tz:en:1:"],
  ];

  it.each(keyRows)("%s", async (_label, input, expectedKey) => {
    fetchGNewsMock.mockResolvedValueOnce([]);
    await invoke({ data: input });
    expect(cacheAsideMock).toHaveBeenCalledTimes(1);
    expect(cacheAsideMock.mock.calls[0]?.[0]).toBe(expectedKey);
  });

  it("uses the real TTL.news value for every request", async () => {
    expect(TTL.news).toBe(90);
    fetchGNewsMock.mockResolvedValue([]);
    await invoke({ data: { category: "sports" } });
    await invoke({ data: { query: "ai" } });
    for (const call of cacheAsideMock.mock.calls) expect(call[1]).toBe(90);
  });

  it("distinct inputs produce distinct cache keys", async () => {
    fetchGNewsMock.mockResolvedValue([]);
    const inputs: unknown[] = [
      undefined,
      { category: "sports" },
      { category: "science" },
      { country: "ke" },
      { lang: "fr" },
      { page: 2 },
      { query: "ai" },
      { query: "ml" },
      { category: "sports", page: 2 },
      { category: "sports", query: "ai" },
    ];
    for (const input of inputs) await invoke({ data: input });
    const keys = cacheAsideMock.mock.calls.map((call) => call[0]);
    expect(keys).toHaveLength(inputs.length);
    expect(new Set(keys).size).toBe(inputs.length);
  });

  it("the cache key embeds the query exactly as the validator trimmed it", async () => {
    fetchGNewsMock.mockResolvedValue([]);
    await invoke({ data: { query: "  climate   change  " } });
    const key = String(cacheAsideMock.mock.calls[0]?.[0]);
    // Outer padding is stripped; internal spaces survive into the key.
    expect(key).toBe("gnews:general:tz:en:1:climate   change");
  });

  it("the loader passes the VALIDATED options to fetchGNews", async () => {
    fetchGNewsMock.mockResolvedValueOnce([]);
    await invoke({ data: { category: "SPORTS", query: " derby ", page: 2, country: "ke" } });
    expect(fetchGNewsMock).toHaveBeenCalledWith({
      category: "sports",
      country: "ke",
      lang: "en",
      page: 2,
      query: "derby",
    });
  });

  it("the loader receives no arguments beyond the validated options object", async () => {
    fetchGNewsMock.mockResolvedValueOnce([]);
    await invoke({ data: {} });
    expect(fetchGNewsMock.mock.calls[0]).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// handler — response shape
// ---------------------------------------------------------------------------

describe("handler: response shape", () => {
  it("returns articles, configured and an ISO fetchedAt", async () => {
    const articles = [{ id: "gnews:a", headline: "A" }];
    fetchGNewsMock.mockResolvedValueOnce(articles as never);
    isGNewsConfiguredMock.mockReturnValueOnce(true);
    const result = await invoke({ data: {} });
    expect(result.articles).toBe(articles);
    expect(result.configured).toBe(true);
    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("fetchedAt reflects the clock at call time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T05:06:07.008Z"));
    fetchGNewsMock.mockResolvedValueOnce([]);
    const result = await invoke({ data: {} });
    expect(result.fetchedAt).toBe("2026-03-04T05:06:07.008Z");
  });

  const configuredRows: Array<[label: boolean]> = [[true], [false]];

  it.each(configuredRows)("configured mirrors isGNewsConfigured -> %s", async (configured) => {
    isGNewsConfiguredMock.mockReturnValueOnce(configured);
    fetchGNewsMock.mockResolvedValueOnce([]);
    const result = await invoke({ data: {} });
    expect(result.configured).toBe(configured);
  });

  const articleShapeRows: Array<[label: string, articles: unknown[]]> = [
    ["an empty article list", []],
    [
      "a single article",
      [{ id: "gnews:x", headline: "X", summary: "", category: "General", state: "developing" }],
    ],
    [
      "ten articles",
      Array.from({ length: 10 }, (_, i) => ({ id: `gnews:${i}`, headline: `H${i}` })),
    ],
  ];

  it.each(articleShapeRows)("passes %s through untouched", async (_label, articles) => {
    fetchGNewsMock.mockResolvedValueOnce(articles as never);
    const result = await invoke({ data: {} });
    expect(result.articles).toEqual(articles);
  });

  it("each request calls the loader exactly once", async () => {
    fetchGNewsMock.mockResolvedValue([]);
    await invoke({ data: { query: "unique-loader-check" } });
    expect(fetchGNewsMock).toHaveBeenCalledTimes(1);
  });

  it("repeated identical requests hit the same cache key (single cacheAside entry per call)", async () => {
    fetchGNewsMock.mockResolvedValue([]);
    await invoke({ data: { page: 7 } });
    await invoke({ data: { page: 7 } });
    expect(cacheAsideMock.mock.calls.map((call) => call[0])).toEqual([
      "gnews:general:tz:en:7:",
      "gnews:general:tz:en:7:",
    ]);
  });

  it("a loader that rejects propagates out of the handler", async () => {
    fetchGNewsMock.mockRejectedValueOnce(new Error("gnews down"));
    await expect(invoke({ data: {} })).rejects.toThrow("gnews down");
  });
});
