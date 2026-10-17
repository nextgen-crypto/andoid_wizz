import { createFileRoute } from "@tanstack/react-router";

import { externalNewsQueryOptions } from "@/frontend/hooks/useNewsStories";
import { storyQueryOptions } from "@/frontend/hooks/useStoryDetail";

import { NewsArticleDetail } from "@/frontend/components/news/NewsArticleDetail";
import { NewsThreadPending, NewsThreadScreen } from "@/frontend/screens/NewsThreadScreen";

type ArticleLoaderData =
  | { type: "external"; story: import("@/frontend/hooks/useNewsStories").NewsStory | null }
  | { type: "internal"; story: unknown };

export const Route = createFileRoute("/news/$articleId")({
  head: () => ({
    meta: [
      { title: "WIZZ — News Article" },
      { name: "description", content: "Read the latest news on WIZZ." },
    ],
  }),

  loader: async ({ context, params }): Promise<ArticleLoaderData> => {
    const { articleId } = params;

    // External GNews articles render the article-detail reader.
    if (articleId.startsWith("gnews:")) {
      const stories = await context.queryClient
        .ensureQueryData(externalNewsQueryOptions)
        .catch(() => []);

      return {
        type: "external",
        story: stories.find((item) => item.id === articleId) ?? null,
      };
    }

    // WIZZ's own stories keep the existing discussion-thread behavior.
    const story = await context.queryClient
      .ensureQueryData(storyQueryOptions(articleId))
      .catch(() => null);

    return {
      type: "internal",
      story,
    };
  },

  pendingComponent: NewsThreadPending,

  component: ArticleRouteComponent,
});

function ArticleRouteComponent() {
  const result = Route.useLoaderData();

  if (result.type === "external") {
    if (!result.story) {
      return (
        <main className="min-h-screen bg-background px-6 py-16 text-foreground">
          <div className="mx-auto max-w-2xl">
            <h1 className="text-2xl font-bold">Article unavailable</h1>
            <p className="mt-3 text-muted-foreground">
              We couldn't find this article in the current news feed. Please return to News and try
              again.
            </p>
          </div>
        </main>
      );
    }

    return <NewsArticleDetail story={result.story} />;
  }

  return <NewsThreadScreen />;
}
