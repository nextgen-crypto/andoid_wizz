const GNEWS_API_URL = "https://gnews.io/api/v4";

export interface GNewsArticle {
  id: string;
  headline: string;
  summary: string;
  category: string;
  state: "breaking" | "developing" | "updated" | "trending" | "live" | "archived";
  coverImageUrl: string;
  createdAt: string;
  postCount: number;
  synthetic: boolean;
  sourceName: string;
  sourceUrl: string;
  articleUrl: string;
}

interface GNewsApiArticle {
  /** URL-safe hex identifier from GNews. Used for the reader route. */
  id?: string;
  title?: string;
  description?: string | null;
  content?: string | null;
  url: string;
  image?: string | null;
  publishedAt: string;
  source?: {
    name?: string;
    url?: string;
  };
}

interface GNewsApiResponse {
  articles?: GNewsApiArticle[];
  errors?: string[];
}

export interface GNewsOptions {
  category?: string;
  query?: string;
  country?: string;
  lang?: string;
  page?: number;
}

const ALLOWED_CATEGORIES = new Set([
  "general",
  "world",
  "nation",
  "business",
  "technology",
  "entertainment",
  "sports",
  "science",
  "health",
]);

function normalizeCategory(category?: string): string {
  const value = category?.toLowerCase() ?? "general";

  return ALLOWED_CATEGORIES.has(value) ? value : "general";
}

function toNewsCategory(category?: string): string {
  const value = normalizeCategory(category);

  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function isGNewsConfigured(): boolean {
  return Boolean(process.env["GNEWS_API_KEY"]);
}

/**
 * Fetch top headlines from GNews.io.
 *
 * Degrades gracefully: when no `GNEWS_API_KEY` is configured (or the upstream
 * errors), this resolves to an empty array instead of throwing, so the news
 * screen still renders internal/seeded stories rather than blanking out.
 */
export async function fetchGNews(options: GNewsOptions = {}): Promise<GNewsArticle[]> {
  const apiKey = process.env["GNEWS_API_KEY"];

  if (!apiKey) {
    return [];
  }

  const params = new URLSearchParams({
    apikey: apiKey,
    lang: options.lang ?? "en",
    max: "10",
    page: String(Math.min(Math.max(options.page ?? 1, 1), 10)),
  });

  if (options.query?.trim()) {
    params.set("q", options.query.trim().slice(0, 200));
  } else {
    params.set("category", normalizeCategory(options.category));
    params.set("country", options.country ?? "tz");
  }

  try {
    const response = await fetch(`${GNEWS_API_URL}/top-headlines?${params.toString()}`, {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.warn(`[gnews] request failed with status ${response.status}`);
      return [];
    }

    const result = (await response.json()) as GNewsApiResponse;

    return (result.articles ?? [])
      .filter((article) => Boolean(article.title && article.url))
      .map((article) => ({
        // Route id must be a single URL segment. GNews's `id` is a URL-safe hex
        // string, so use it; if it's ever absent, fall back to a sanitized hash
        // of the URL. Never put the raw article URL here — it contains slashes
        // and would break the /news/$articleId route (extra path segments).
        id: `gnews:${article.id ?? article.url.replace(/[^a-zA-Z0-9]/g, "")}`,
        headline: article.title ?? "Untitled story",
        summary: article.description ?? "",
        category: toNewsCategory(options.category),
        state: "developing" as const,
        coverImageUrl: article.image ?? "",
        createdAt: article.publishedAt,
        postCount: 0,
        synthetic: false as const,
        sourceName: article.source?.name ?? "Unknown publisher",
        sourceUrl: article.source?.url ?? "",
        articleUrl: article.url,
      }));
  } catch (error) {
    console.warn("[gnews] fetch errored:", error);
    return [];
  }
}
