import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  externalNewsQueryOptions,
  newsStoriesQueryOptions,
  type NewsStory,
} from "@/frontend/hooks/useNewsStories";
import { StoryListItem } from "@/frontend/components/news/StoryListItem";

const MAX_RECOMMENDATIONS = 5;

interface NewsRecommendationsProps {
  /** The story currently open — excluded from its own recommendations. */
  story: Pick<NewsStory, "id" | "headline" | "category">;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
}

/**
 * "Recommended" rail shown beneath a news article.
 *
 * Scores every other story (internal + external) by shared category and
 * headline/summary keyword overlap, then surfaces the top few via the standard
 * story row. Reads from the same React Query caches the news feed already
 * populates, so it costs no extra network calls, and renders nothing when
 * there are no candidates — never a blank or broken block.
 */
export function NewsRecommendations({ story }: NewsRecommendationsProps) {
  const { data: internal } = useQuery(newsStoriesQueryOptions);
  const { data: external = [] } = useQuery(externalNewsQueryOptions);

  const recommendations = useMemo(() => {
    const keywords = new Set(tokenize(story.headline));

    const merged = [...(internal?.stories ?? []), ...external];
    const seen = new Set<string>([story.id]);

    // Score only influences ordering — never exclusion — so every article
    // surfaces a full rail (relevance first, recency breaks ties). The sole
    // empty case is when no other stories exist at all.
    const scored = merged.flatMap((candidate) => {
      if (seen.has(candidate.id)) return [];
      seen.add(candidate.id);

      let score = candidate.category === story.category ? 3 : 0;
      const haystack = tokenize(`${candidate.headline} ${candidate.summary}`);
      for (const word of haystack) {
        if (keywords.has(word)) score += 1;
      }

      return [{ candidate, score }];
    });

    return scored
      .sort(
        (a, b) =>
          b.score - a.score ||
          Date.parse(b.candidate.createdAt) - Date.parse(a.candidate.createdAt),
      )
      .slice(0, MAX_RECOMMENDATIONS)
      .map((entry) => entry.candidate);
  }, [internal?.stories, external, story.id, story.headline, story.category]);

  if (recommendations.length === 0) return null;

  return (
    <section aria-label="Recommended stories" className="border-t border-border">
      <h2 className="px-4 pb-1 pt-4 text-sm font-extrabold text-foreground">Recommended</h2>
      <div className="divide-y divide-border">
        {recommendations.map((candidate) => (
          <StoryListItem key={candidate.id} story={candidate} />
        ))}
      </div>
    </section>
  );
}
