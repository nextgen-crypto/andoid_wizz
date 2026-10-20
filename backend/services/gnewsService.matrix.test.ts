import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Table-driven matrix for backend/services/gnewsService.ts.
 *
 * `fetch` is stubbed globally and every row pins the exact request URL (or the
 * exact mapped article object) against hard-coded expectations — expectations
 * are never derived from the code under test. No network access.
 */

const { fetchGNews, isGNewsConfigured } = await import("./gnewsService");

const API_BASE = "https://gnews.io/api/v4/top-headlines";

type CapturedCall = { url: string; init: RequestInit | undefined };
let calls: CapturedCall[] = [];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Install a fetch stub that records calls and answers with `responder`. */
function installFetch(
  responder: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init });
      return responder(String(input), init);
    }),
  );
}

/** Fetch stub that answers any request with the given articles payload. */
function installArticles(articles: unknown, status = 200): void {
  installFetch(() => jsonResponse({ articles }, status));
}

function paramsOf(callIndex = 0): URLSearchParams {
  const call = calls[callIndex];
  expect(call).toBeDefined();
  const url = new URL((call as CapturedCall).url);
  expect(url.origin + url.pathname).toBe(API_BASE);
  return url.searchParams;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// isGNewsConfigured
// ---------------------------------------------------------------------------

describe("isGNewsConfigured", () => {
  const rows: Array<[label: string, env: string | undefined, expected: boolean]> = [
    ["a normal key", "abc123", true],
    ["an empty value", "", false],
    ["a whitespace value", "   ", true],
    ["undefined (unset)", undefined, false],
    ["a key with special characters", "key with spaces/+slash", true],
  ];

  it.each(rows)("%s -> %s", (_label, env, expected) => {
    if (env === undefined) vi.stubEnv("GNEWS_API_KEY", undefined);
    else vi.stubEnv("GNEWS_API_KEY", env);
    expect(isGNewsConfigured()).toBe(expected);
  });

  it("reflects the env at call time, not at module load", () => {
    vi.stubEnv("GNEWS_API_KEY", "first");
    expect(isGNewsConfigured()).toBe(true);
    vi.stubEnv("GNEWS_API_KEY", undefined);
    expect(isGNewsConfigured()).toBe(false);
    vi.stubEnv("GNEWS_API_KEY", "again");
    expect(isGNewsConfigured()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No API key -> graceful degradation, no network call
// ---------------------------------------------------------------------------

describe("fetchGNews without an API key", () => {
  const optionRows: Array<[string, Record<string, unknown>]> = [
    ["no options", {}],
    ["a category", { category: "technology" }],
    ["a query", { query: "ai" }],
    ["a page", { page: 3 }],
    ["everything", { category: "sports", query: "x", country: "us", lang: "fr", page: 2 }],
  ];

  it.each(optionRows)("resolves [] for %s and never calls fetch", async (_label, options) => {
    vi.stubEnv("GNEWS_API_KEY", undefined);
    installFetch(() => jsonResponse({ articles: [] }));
    await expect(fetchGNews(options)).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("treats an empty-string key as unconfigured", async () => {
    vi.stubEnv("GNEWS_API_KEY", "");
    installFetch(() => jsonResponse({ articles: [] }));
    await expect(fetchGNews({ query: "anything" })).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Request shape — exact URLs
// ---------------------------------------------------------------------------

describe("fetchGNews request URL", () => {
  const urlRows: Array<[label: string, options: Record<string, unknown>, expectedUrl: string]> = [
    [
      "defaults",
      {},
      `${API_BASE}?apikey=test-key&lang=en&max=10&page=1&category=general&country=tz`,
    ],
    [
      "custom lang",
      { lang: "fr" },
      `${API_BASE}?apikey=test-key&lang=fr&max=10&page=1&category=general&country=tz`,
    ],
    [
      "a category",
      { category: "technology" },
      `${API_BASE}?apikey=test-key&lang=en&max=10&page=1&category=technology&country=tz`,
    ],
    [
      "a country",
      { country: "us" },
      `${API_BASE}?apikey=test-key&lang=en&max=10&page=1&category=general&country=us`,
    ],
    [
      "a page",
      { page: 4 },
      `${API_BASE}?apikey=test-key&lang=en&max=10&page=4&category=general&country=tz`,
    ],
    [
      "a plain query replaces category+country",
      { query: "ai" },
      `${API_BASE}?apikey=test-key&lang=en&max=10&page=1&q=ai`,
    ],
    [
      "a query with a space is form-encoded",
      { query: "climate change" },
      `${API_BASE}?apikey=test-key&lang=en&max=10&page=1&q=climate+change`,
    ],
    [
      "a query wins over category and country",
      { query: "ai", category: "sports", country: "de" },
      `${API_BASE}?apikey=test-key&lang=en&max=10&page=1&q=ai`,
    ],
    [
      "lang and page combine with a query",
      { query: "ai", lang: "es", page: 2 },
      `${API_BASE}?apikey=test-key&lang=es&max=10&page=2&q=ai`,
    ],
    [
      "category with language",
      { category: "business", lang: "pt" },
      `${API_BASE}?apikey=test-key&lang=pt&max=10&page=1&category=business&country=tz`,
    ],
  ];

  it.each(urlRows)("%s", async (_label, options, expectedUrl) => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    installArticles([]);
    await fetchGNews(options);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(expectedUrl);
  });

  it("sends Accept: application/json with no method override and a timeout signal", async () => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    installArticles([]);
    await fetchGNews({});
    const init = calls[0]?.init;
    expect(init?.method).toBeUndefined();
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
    expect(new Headers(init?.headers).get("content-type")).toBeNull();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses a fresh AbortSignal per call", async () => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    installArticles([]);
    await fetchGNews({});
    await fetchGNews({});
    expect(calls).toHaveLength(2);
    expect(calls[0]?.init?.signal).not.toBe(calls[1]?.init?.signal);
  });
});

// ---------------------------------------------------------------------------
// page clamping
// ---------------------------------------------------------------------------

describe("fetchGNews page clamping", () => {
  const pageRows: Array<[label: string, page: number | undefined, expectedParam: string]> = [
    ["undefined -> 1", undefined, "1"],
    ["1 -> 1", 1, "1"],
    ["2 -> 2", 2, "2"],
    ["9 -> 9", 9, "9"],
    ["10 -> 10", 10, "10"],
    ["11 -> clamped to 10", 11, "10"],
    ["999 -> clamped to 10", 999, "10"],
    ["1e9 -> clamped to 10", 1_000_000_000, "10"],
    ["0 -> clamped to 1", 0, "1"],
    ["-1 -> clamped to 1", -1, "1"],
    ["-1e9 -> clamped to 1", -1_000_000_000, "1"],
    ["-0.5 -> clamped to 1", -0.5, "1"],
    ["3.5 passes through unrounded", 3.5, "3.5"],
  ];

  it.each(pageRows)("page=%s %s", async (_label, page, expectedParam) => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    installArticles([]);
    await fetchGNews(page === undefined ? {} : { page });
    expect(paramsOf().get("page")).toBe(expectedParam);
  });

  it("max is always 10 regardless of page", async () => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    installArticles([]);
    await fetchGNews({ page: 7 });
    expect(paramsOf().get("max")).toBe("10");
  });
});

// ---------------------------------------------------------------------------
// query vs category/country selection
// ---------------------------------------------------------------------------

describe("fetchGNews query vs category path", () => {
  const queryRows: Array<[label: string, query: string | undefined, hasQuery: boolean]> = [
    ["a plain query", "ai", true],
    ["a padded query is trimmed", "  ai  ", true],
    ["a multi-word query", "climate change", true],
    ["a single character", "x", true],
    ["an empty query falls back", "", false],
    ["a whitespace-only query falls back", "   ", false],
    ["a tab-only query falls back", "\t", false],
    ["undefined falls back", undefined, false],
  ];

  it.each(queryRows)("%s", async (_label, query, hasQuery) => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    installArticles([]);
    await fetchGNews(query === undefined ? { category: "sports" } : { query });
    const params = paramsOf();
    if (hasQuery) {
      expect(params.get("q")).not.toBeNull();
      expect(params.get("category")).toBeNull();
      expect(params.get("country")).toBeNull();
    } else {
      expect(params.get("q")).toBeNull();
      expect(params.get("category")).not.toBeNull();
      expect(params.get("country")).not.toBeNull();
    }
  });

  const queryLenRows: Array<[label: string, query: string, expectedQ: string]> = [
    ["199 chars pass through", "a".repeat(199), "a".repeat(199)],
    ["exactly 200 chars pass through", "a".repeat(200), "a".repeat(200)],
    ["201 chars are sliced to 200", "a".repeat(201), "a".repeat(200)],
    ["500 chars are sliced to 200", "a".repeat(500), "a".repeat(200)],
    ["padding is trimmed before slicing", `  ${"b".repeat(250)}  `, "b".repeat(200)],
  ];

  it.each(queryLenRows)("%s", async (_label, query, expectedQ) => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    installArticles([]);
    await fetchGNews({ query });
    expect(paramsOf().get("q")).toBe(expectedQ);
  });

  it("country is dropped whenever a query is present", async () => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    installArticles([]);
    await fetchGNews({ query: "ai", country: "ng" });
    expect(paramsOf().get("country")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// category normalization (URL param AND mapped article.category)
// ---------------------------------------------------------------------------

describe("category normalization", () => {
  const categoryRows: Array<[label: string, input: string | undefined, normalized: string]> = [
    ["undefined -> general", undefined, "general"],
    ["general stays general", "general", "general"],
    ["world stays world", "world", "world"],
    ["nation stays nation", "nation", "nation"],
    ["business stays business", "business", "business"],
    ["technology stays technology", "technology", "technology"],
    ["entertainment stays entertainment", "entertainment", "entertainment"],
    ["sports stays sports", "sports", "sports"],
    ["science stays science", "science", "science"],
    ["health stays health", "health", "health"],
    ["uppercase GENERAL normalizes", "GENERAL", "general"],
    ["mixed-case Technology normalizes", "Technology", "technology"],
    ["an unknown category -> general", "politics", "general"],
    ["an empty string -> general", "", "general"],
    ["a padded category -> general", " sports", "general"],
    ["a trailing-space category -> general", "sports ", "general"],
    ["a partial match -> general", "tech", "general"],
    ["a near-miss with punctuation -> general", "sports!", "general"],
  ];

  it.each(categoryRows)("URL param: %s", async (_label, input, normalized) => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    installArticles([]);
    await fetchGNews(input === undefined ? {} : { category: input });
    expect(paramsOf().get("category")).toBe(normalized);
  });

  const mappedCategoryRows: Array<[input: string | undefined, expected: string]> = [
    [undefined, "General"],
    ["general", "General"],
    ["world", "World"],
    ["nation", "Nation"],
    ["business", "Business"],
    ["technology", "Technology"],
    ["entertainment", "Entertainment"],
    ["sports", "Sports"],
    ["science", "Science"],
    ["health", "Health"],
    ["TECHNOLOGY", "Technology"],
    ["bogus", "General"],
    ["", "General"],
  ];

  it.each(mappedCategoryRows)("mapped category %j -> %j", async (input, expected) => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    installArticles([
      {
        id: "abc",
        title: "T",
        url: "https://x.test/a",
        publishedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    const result = await fetchGNews(input === undefined ? {} : { category: input });
    expect(result).toHaveLength(1);
    expect(result[0]?.category).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Article mapping — full-object expectations
// ---------------------------------------------------------------------------

describe("fetchGNews article mapping", () => {
  const baseArticle = {
    id: "abc123def",
    title: "Tanzania builds a new rail link",
    description: "A short summary of the rail project.",
    url: "https://news.test/2026/rail-link",
    image: "https://cdn.test/rail.jpg",
    publishedAt: "2026-01-02T03:04:05Z",
    source: { name: "Daily Test", url: "https://daily.test" },
  };

  const mappingRows: Array<[label: string, article: unknown, expected: unknown]> = [
    [
      "a fully-poped article maps every field",
      baseArticle,
      {
        id: "gnews:abc123def",
        headline: "Tanzania builds a new rail link",
        summary: "A short summary of the rail project.",
        category: "Technology",
        state: "developing",
        coverImageUrl: "https://cdn.test/rail.jpg",
        createdAt: "2026-01-02T03:04:05Z",
        postCount: 0,
        synthetic: false,
        sourceName: "Daily Test",
        sourceUrl: "https://daily.test",
        articleUrl: "https://news.test/2026/rail-link",
      },
    ],
    [
      "a null description maps to an empty summary",
      { ...baseArticle, description: null },
      {
        id: "gnews:abc123def",
        headline: "Tanzania builds a new rail link",
        summary: "",
        category: "Technology",
        state: "developing",
        coverImageUrl: "https://cdn.test/rail.jpg",
        createdAt: "2026-01-02T03:04:05Z",
        postCount: 0,
        synthetic: false,
        sourceName: "Daily Test",
        sourceUrl: "https://daily.test",
        articleUrl: "https://news.test/2026/rail-link",
      },
    ],
    [
      "an undefined description maps to an empty summary",
      { ...baseArticle, description: undefined },
      {
        id: "gnews:abc123def",
        headline: "Tanzania builds a new rail link",
        summary: "",
        category: "Technology",
        state: "developing",
        coverImageUrl: "https://cdn.test/rail.jpg",
        createdAt: "2026-01-02T03:04:05Z",
        postCount: 0,
        synthetic: false,
        sourceName: "Daily Test",
        sourceUrl: "https://daily.test",
        articleUrl: "https://news.test/2026/rail-link",
      },
    ],
    [
      "a null image maps to an empty cover",
      { ...baseArticle, image: null },
      {
        id: "gnews:abc123def",
        headline: "Tanzania builds a new rail link",
        summary: "A short summary of the rail project.",
        category: "Technology",
        state: "developing",
        coverImageUrl: "",
        createdAt: "2026-01-02T03:04:05Z",
        postCount: 0,
        synthetic: false,
        sourceName: "Daily Test",
        sourceUrl: "https://daily.test",
        articleUrl: "https://news.test/2026/rail-link",
      },
    ],
    [
      "a missing source becomes Unknown publisher",
      { ...baseArticle, source: undefined },
      {
        id: "gnews:abc123def",
        headline: "Tanzania builds a new rail link",
        summary: "A short summary of the rail project.",
        category: "Technology",
        state: "developing",
        coverImageUrl: "https://cdn.test/rail.jpg",
        createdAt: "2026-01-02T03:04:05Z",
        postCount: 0,
        synthetic: false,
        sourceName: "Unknown publisher",
        sourceUrl: "",
        articleUrl: "https://news.test/2026/rail-link",
      },
    ],
    [
      "an empty source object becomes Unknown publisher",
      { ...baseArticle, source: {} },
      {
        id: "gnews:abc123def",
        headline: "Tanzania builds a new rail link",
        summary: "A short summary of the rail project.",
        category: "Technology",
        state: "developing",
        coverImageUrl: "https://cdn.test/rail.jpg",
        createdAt: "2026-01-02T03:04:05Z",
        postCount: 0,
        synthetic: false,
        sourceName: "Unknown publisher",
        sourceUrl: "",
        articleUrl: "https://news.test/2026/rail-link",
      },
    ],
    [
      "a source without a name keeps the url",
      { ...baseArticle, source: { url: "https://only.test" } },
      {
        id: "gnews:abc123def",
        headline: "Tanzania builds a new rail link",
        summary: "A short summary of the rail project.",
        category: "Technology",
        state: "developing",
        coverImageUrl: "https://cdn.test/rail.jpg",
        createdAt: "2026-01-02T03:04:05Z",
        postCount: 0,
        synthetic: false,
        sourceName: "Unknown publisher",
        sourceUrl: "https://only.test",
        articleUrl: "https://news.test/2026/rail-link",
      },
    ],
    [
      "a source without a url keeps the name",
      { ...baseArticle, source: { name: "Only Name" } },
      {
        id: "gnews:abc123def",
        headline: "Tanzania builds a new rail link",
        summary: "A short summary of the rail project.",
        category: "Technology",
        state: "developing",
        coverImageUrl: "https://cdn.test/rail.jpg",
        createdAt: "2026-01-02T03:04:05Z",
        postCount: 0,
        synthetic: false,
        sourceName: "Only Name",
        sourceUrl: "",
        articleUrl: "https://news.test/2026/rail-link",
      },
    ],
    [
      "a missing id falls back to a URL-sanitized segment",
      { ...baseArticle, id: undefined },
      {
        id: "gnews:httpsnewstest2026raillink",
        headline: "Tanzania builds a new rail link",
        summary: "A short summary of the rail project.",
        category: "Technology",
        state: "developing",
        coverImageUrl: "https://cdn.test/rail.jpg",
        createdAt: "2026-01-02T03:04:05Z",
        postCount: 0,
        synthetic: false,
        sourceName: "Daily Test",
        sourceUrl: "https://daily.test",
        articleUrl: "https://news.test/2026/rail-link",
      },
    ],
    [
      "a null id falls back to a URL-sanitized segment",
      { ...baseArticle, id: null },
      {
        id: "gnews:httpsnewstest2026raillink",
        headline: "Tanzania builds a new rail link",
        summary: "A short summary of the rail project.",
        category: "Technology",
        state: "developing",
        coverImageUrl: "https://cdn.test/rail.jpg",
        createdAt: "2026-01-02T03:04:05Z",
        postCount: 0,
        synthetic: false,
        sourceName: "Daily Test",
        sourceUrl: "https://daily.test",
        articleUrl: "https://news.test/2026/rail-link",
      },
    ],
    [
      "an empty-string id is kept as-is (not nullish)",
      { ...baseArticle, id: "" },
      {
        id: "gnews:",
        headline: "Tanzania builds a new rail link",
        summary: "A short summary of the rail project.",
        category: "Technology",
        state: "developing",
        coverImageUrl: "https://cdn.test/rail.jpg",
        createdAt: "2026-01-02T03:04:05Z",
        postCount: 0,
        synthetic: false,
        sourceName: "Daily Test",
        sourceUrl: "https://daily.test",
        articleUrl: "https://news.test/2026/rail-link",
      },
    ],
    [
      "the sanitized id fallback strips every non-alphanumeric char",
      { ...baseArticle, id: undefined, url: "https://a.b/c?d=e&f=g#h-i_9" },
      {
        id: "gnews:httpsabcdefghi9",
        headline: "Tanzania builds a new rail link",
        summary: "A short summary of the rail project.",
        category: "Technology",
        state: "developing",
        coverImageUrl: "https://cdn.test/rail.jpg",
        createdAt: "2026-01-02T03:04:05Z",
        postCount: 0,
        synthetic: false,
        sourceName: "Daily Test",
        sourceUrl: "https://daily.test",
        articleUrl: "https://a.b/c?d=e&f=g#h-i_9",
      },
    ],
    [
      "unicode headline and summary pass through untouched",
      { ...baseArticle, title: "Habari za 🇹🇿 — matengo", description: "Maelezo ya kina…" },
      {
        id: "gnews:abc123def",
        headline: "Habari za 🇹🇿 — matengo",
        summary: "Maelezo ya kina…",
        category: "Technology",
        state: "developing",
        coverImageUrl: "https://cdn.test/rail.jpg",
        createdAt: "2026-01-02T03:04:05Z",
        postCount: 0,
        synthetic: false,
        sourceName: "Daily Test",
        sourceUrl: "https://daily.test",
        articleUrl: "https://news.test/2026/rail-link",
      },
    ],
    [
      "an empty description is preserved as an empty summary",
      { ...baseArticle, description: "" },
      {
        id: "gnews:abc123def",
        headline: "Tanzania builds a new rail link",
        summary: "",
        category: "Technology",
        state: "developing",
        coverImageUrl: "https://cdn.test/rail.jpg",
        createdAt: "2026-01-02T03:04:05Z",
        postCount: 0,
        synthetic: false,
        sourceName: "Daily Test",
        sourceUrl: "https://daily.test",
        articleUrl: "https://news.test/2026/rail-link",
      },
    ],
  ];

  it.each(mappingRows)("%s", async (_label, article, expected) => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    installArticles([article]);
    const result = await fetchGNews({ category: "technology" });
    expect(result).toEqual([expected]);
  });

  const invariantRows: Array<[label: string, article: unknown]> = [
    ["a full article", baseArticle],
    ["an article without a source", { ...baseArticle, source: undefined }],
    ["an article without an image", { ...baseArticle, image: null }],
    ["an article without a description", { ...baseArticle, description: null }],
  ];

  it.each(invariantRows)("every mapped %s has fixed fields", async (_label, article) => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    installArticles([article]);
    const [mapped] = await fetchGNews({});
    expect(mapped).toBeDefined();
    const m = mapped as unknown as Record<string, unknown>;
    expect(m["state"]).toBe("developing");
    expect(m["postCount"]).toBe(0);
    expect(m["synthetic"]).toBe(false);
    expect(typeof m["id"]).toBe("string");
    expect((m["id"] as string).startsWith("gnews:")).toBe(true);
    expect(m["id"]).not.toContain("/");
    // The only colon is the "gnews:" prefix itself — the segment after it is
    // a single route-safe path piece.
    expect((m["id"] as string).slice("gnews:".length)).not.toContain(":");
  });

  it("the route id never contains a slash even from the URL fallback", async () => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    installArticles([
      { id: undefined, title: "T", url: "https://deep.test/a/b/c/d", publishedAt: "2026-01-01" },
    ]);
    const [mapped] = await fetchGNews({});
    expect((mapped as { id: string }).id).toBe("gnews:httpsdeeptestabcd");
  });
});

// ---------------------------------------------------------------------------
// Batch shapes — ordering, filtering, empty payloads
// ---------------------------------------------------------------------------

describe("fetchGNews batch handling", () => {
  const batchArticles = [
    {
      id: "a1",
      title: "First",
      url: "https://x.test/1",
      publishedAt: "2026-01-01T00:00:00Z",
    },
    { title: "No url", publishedAt: "2026-01-01T00:00:00Z" },
    {
      id: "a3",
      title: "Third",
      url: "https://x.test/3",
      publishedAt: "2026-01-03T00:00:00Z",
    },
    { id: "a4", url: "https://x.test/4", publishedAt: "2026-01-04T00:00:00Z" },
    {
      id: "a5",
      title: "Fifth",
      url: "https://x.test/5",
      publishedAt: "2026-01-05T00:00:00Z",
    },
  ];

  it("filters out articles without a title or url and keeps upstream order", async () => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    installArticles(batchArticles);
    const result = await fetchGNews({});
    expect(result.map((a) => a.headline)).toEqual(["First", "Third", "Fifth"]);
    expect(result.map((a) => a.articleUrl)).toEqual([
      "https://x.test/1",
      "https://x.test/3",
      "https://x.test/5",
    ]);
    expect(result.map((a) => a.id)).toEqual(["gnews:a1", "gnews:a3", "gnews:a5"]);
  });

  const shapeRows: Array<[label: string, payload: unknown]> = [
    ["an empty articles array", []],
    ["a single article", [{ id: "z", title: "One", url: "https://x.test/z", publishedAt: "p" }]],
    [
      "ten articles",
      Array.from({ length: 10 }, (_, i) => ({
        id: `id-${i}`,
        title: `Headline ${i}`,
        url: `https://x.test/${i}`,
        publishedAt: "p",
      })),
    ],
    ["an articles value that is not an array", "oops"],
    ["articles: null", null],
  ];

  it.each(shapeRows)("handles %s", async (_label, payload) => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installFetch(() => jsonResponse({ articles: payload }));
    const result = await fetchGNews({});
    if (Array.isArray(payload)) expect(result).toHaveLength(payload.length);
    else expect(result).toEqual([]);
  });

  const payloadRows: Array<[label: string, payload: unknown]> = [
    ["an empty object", {}],
    ["only an errors array", { errors: ["quota exceeded"] }],
    ["a null body", null],
    ["an array body", []],
    ["a string body", "nope"],
  ];

  it.each(payloadRows)("resolves [] for %s", async (_label, payload) => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installFetch(() => jsonResponse(payload));
    await expect(fetchGNews({})).resolves.toEqual([]);
  });

  it("applies the requested category to every article in the batch", async () => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    installArticles([
      { id: "1", title: "A", url: "https://x.test/1", publishedAt: "p" },
      { id: "2", title: "B", url: "https://x.test/2", publishedAt: "p" },
      { id: "3", title: "C", url: "https://x.test/3", publishedAt: "p" },
    ]);
    const result = await fetchGNews({ category: "science" });
    expect(result.map((a) => a.category)).toEqual(["Science", "Science", "Science"]);
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation on upstream failures
// ---------------------------------------------------------------------------

describe("fetchGNews upstream failure handling", () => {
  const statusRows = [400, 401, 403, 404, 429, 500, 502, 503, 504];

  it.each(statusRows)("status %i -> []", async (status) => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installFetch(() => new Response("upstream sad", { status }));
    await expect(fetchGNews({})).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("a 204 with no body -> [] (json parse fails, caught)", async () => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installFetch(() => new Response(null, { status: 204 }));
    await expect(fetchGNews({})).resolves.toEqual([]);
  });

  it("a 200 with a non-JSON body -> []", async () => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installFetch(() => new Response("<html>gateway</html>", { status: 200 }));
    await expect(fetchGNews({})).resolves.toEqual([]);
  });

  it("a 200 with truncated JSON -> []", async () => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installFetch(() => new Response('[{"articles":', { status: 200 }));
    await expect(fetchGNews({})).resolves.toEqual([]);
  });

  const errorRows: Array<[label: string, error: () => unknown]> = [
    ["a TypeError", () => new TypeError("Failed to fetch")],
    [
      "an AbortError",
      () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        return err;
      },
    ],
    ["a plain Error", () => new Error("boom")],
  ];

  it.each(errorRows)("a fetch that rejects with %s -> []", async (_label, makeError) => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<Response> => {
        calls.push({ url: "unreachable", init: undefined });
        throw makeError();
      }),
    );
    await expect(fetchGNews({ query: "never" })).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("still performs the request when the response body later fails to parse", async () => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installArticles(undefined, 200);
    await expect(fetchGNews({ page: 5 })).resolves.toEqual([]);
    expect(paramsOf().get("page")).toBe("5");
  });

  it("degrades per call — a failed call does not poison the next one", async () => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let fail = true;
    installFetch(() => {
      if (fail) return new Response("boom", { status: 500 });
      return jsonResponse({
        articles: [{ id: "ok", title: "Back", url: "https://x.test/ok", publishedAt: "p" }],
      });
    });
    await expect(fetchGNews({})).resolves.toEqual([]);
    fail = false;
    const result = await fetchGNews({});
    expect(result).toHaveLength(1);
    expect(result[0]?.headline).toBe("Back");
  });

  it("warns once per failed request with the status in the message", async () => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installFetch(() => new Response("nope", { status: 403 }));
    await fetchGNews({});
    expect(warn).toHaveBeenCalledWith("[gnews] request failed with status 403");
  });

  it("warns with the thrown error when fetch rejects", async () => {
    vi.stubEnv("GNEWS_API_KEY", "test-key");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const boom = new Error("socket hang up");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<Response> => {
        throw boom;
      }),
    );
    await fetchGNews({});
    expect(warn).toHaveBeenCalledWith("[gnews] fetch errored:", boom);
  });
});
