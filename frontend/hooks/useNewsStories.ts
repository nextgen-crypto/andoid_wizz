import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchExternalNews } from "@/backend/api/news-provider.functions";

export type StoryState = "breaking" | "developing" | "updated" | "trending" | "live" | "archived";

export interface NewsStory {
  id: string;
  headline: string;
  summary: string;
  summaryShort: string;
  category: string;
  state: StoryState;
  coverImageUrl: string;
  createdAt: string;
  postCount: number;
  /** Hashtag-derived fallback when news_stories is absent. */
  synthetic: boolean;

  /** Full body text when available (external articles carry a longer summary). */
  content?: string;
  updatedAt?: string | null;

  /** Publisher attribution for externally-sourced (GNews) stories. */
  sourceName?: string;
  sourceUrl?: string;
  articleUrl?: string;
}

function isMissingTable(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /42P01|PGRST205|Could not find the table|does not exist/i.test(msg);
}

/** Hashtag-derived stories from live posts (pre-migration fallback). */
async function hashtagStories(): Promise<NewsStory[]> {
  const { data, error } = await supabase
    .from("posts")
    .select("hashtags, created_at")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  const counts = new Map<string, { count: number; latest: string }>();
  for (const row of (data ?? []) as { hashtags: string[]; created_at: string }[]) {
    for (const raw of row.hashtags ?? []) {
      const tag = raw.trim().toLowerCase();
      if (!tag) continue;
      const prev = counts.get(tag) ?? { count: 0, latest: row.created_at };
      counts.set(tag, { count: prev.count + 1, latest: row.created_at });
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].latest.localeCompare(a[1].latest))
    .slice(0, 20)
    .map(([tag, v]) => ({
      id: `tag:${tag}`,
      headline: `#${tag}`,
      summary: "",
      summaryShort: "",
      category: "News",
      state: "developing" as StoryState,
      coverImageUrl: "",
      createdAt: v.latest,
      postCount: v.count,
      synthetic: true,
    }));
}

/** Today's stories, newest first. Falls back to hashtag topics pre-migration. */
export const newsStoriesQueryOptions = queryOptions({
  queryKey: ["news-stories"],
  staleTime: 60_000,
  retry: false,
  queryFn: async (): Promise<{ stories: NewsStory[]; live: boolean }> => {
    try {
      const { data: rows, error } = await supabase
        .from("news_stories")
        .select(
          "id, headline, summary, summary_short, category, state, cover_image_url, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const ids = ((rows ?? []) as { id: string }[]).map((r) => r.id);
      const counts = new Map<string, number>();
      if (ids.length > 0) {
        const { data: links } = await supabase
          .from("story_posts")
          .select("story_id")
          .in("story_id", ids)
          .limit(2000);
        for (const l of (links ?? []) as { story_id: string }[]) {
          counts.set(l.story_id, (counts.get(l.story_id) ?? 0) + 1);
        }
      }
      return {
        live: true,
        stories: (
          (rows ?? []) as {
            id: string;
            headline: string;
            summary: string | null;
            summary_short: string | null;
            category: string | null;
            state: string | null;
            cover_image_url: string | null;
            created_at: string;
          }[]
        ).map((r) => ({
          id: r.id,
          headline: r.headline,
          summary: r.summary ?? "",
          summaryShort: r.summary_short ?? "",
          category: r.category ?? "News",
          state: (r.state ?? "developing") as StoryState,
          coverImageUrl: r.cover_image_url ?? "",
          createdAt: r.created_at,
          postCount: counts.get(r.id) ?? 0,
          synthetic: false,
        })),
      };
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      return { live: false, stories: await hashtagStories() };
    }
  },
});

export function useNewsStories() {
  return useQuery(newsStoriesQueryOptions);
}

/**
 * External headlines pulled from GNews.io via the server function.
 *
 * Degrades gracefully: the server returns an empty list when no API key is
 * configured or the upstream fails, so this simply yields no external stories
 * and the news screen keeps rendering internal/seeded ones. Never throws.
 */
export const externalNewsQueryOptions = queryOptions({
  queryKey: ["external-news", "general"],
  staleTime: 5 * 60 * 1000,
  retry: false,
  queryFn: async (): Promise<NewsStory[]> => {
    try {
      const response = await fetchExternalNews({
        data: {
          category: "general",
        },
      });

      return (response?.articles ?? []).map((article) => ({
        id: article.id,
        headline: article.headline,
        summary: article.summary,
        // GNews has no separate short summary or body — reuse the description
        // for both so the list and detail views have something to render.
        summaryShort: article.summary,
        content: article.summary,
        category: article.category,
        state: article.state,
        coverImageUrl: article.coverImageUrl,
        createdAt: article.createdAt,
        updatedAt: null,
        postCount: article.postCount,
        synthetic: article.synthetic,
        sourceName: article.sourceName,
        sourceUrl: article.sourceUrl,
        articleUrl: article.articleUrl,
      }));
    } catch {
      // Graceful degradation — external news is a nice-to-have, never fatal.
      return [];
    }
  },
});
