import { createServerFn } from "@tanstack/react-start";
import { fetchGNews, isGNewsConfigured, type GNewsOptions } from "../services/gnewsService";
import { cacheAside, TTL } from "../cache/redisCache";

const NEWS_CATEGORIES = [
  "general",
  "world",
  "nation",
  "business",
  "technology",
  "entertainment",
  "sports",
  "science",
  "health",
] as const;

type NewsRequest = {
  category?: string;
  query?: string;
  country?: string;
  lang?: string;
  page?: number;
};

function validateNewsRequest(data: NewsRequest | undefined): GNewsOptions {
  const requestedCategory = data?.category?.toLowerCase();

  const category =
    requestedCategory &&
    NEWS_CATEGORIES.includes(requestedCategory as (typeof NEWS_CATEGORIES)[number])
      ? requestedCategory
      : "general";

  const query = typeof data?.query === "string" ? data.query.trim().slice(0, 200) : undefined;

  const options: GNewsOptions = {
    category,
    country: data?.country ?? "tz",
    lang: data?.lang ?? "en",
    ...(data?.page ? { page: data.page } : {}),
    ...(query ? { query } : {}),
  };

  return options;
}

export const fetchExternalNews = createServerFn({
  method: "GET",
})
  .validator((data: NewsRequest | undefined) => validateNewsRequest(data))
  .handler(async ({ data }) => {
    // This endpoint is public and quota-bound (GNews): serve repeat requests
    // from cache so a hot category or a hammering client can't burn the key.
    const cacheKey = [
      "gnews",
      data.category ?? "general",
      data.country ?? "tz",
      data.lang ?? "en",
      data.page ?? 1,
      data.query ?? "",
    ].join(":");
    const articles = await cacheAside(cacheKey, TTL.news, () => fetchGNews(data));

    return {
      articles,
      configured: isGNewsConfigured(),
      fetchedAt: new Date().toISOString(),
    };
  });
