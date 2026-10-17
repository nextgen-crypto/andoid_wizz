import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Bookmark, Check, ExternalLink, Share2 } from "lucide-react";

import type { NewsStory } from "@/frontend/hooks/useNewsStories";
import { cn } from "@/lib/utils";

interface NewsArticleDetailProps {
  story: NewsStory;
}

const BOOKMARK_KEY = "wizz:bookmarked-news";

function formatPublishedDate(date: string): string {
  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return "Publication date unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  }).format(parsed);
}

/** Detail reader for an externally-sourced (GNews) article. */
export function NewsArticleDetail({ story }: NewsArticleDetailProps) {
  const [bookmarked, setBookmarked] = useState(() => {
    if (typeof window === "undefined") return false;

    try {
      const saved = JSON.parse(localStorage.getItem(BOOKMARK_KEY) ?? "[]") as string[];
      return saved.includes(story.id);
    } catch {
      return false;
    }
  });

  const [copied, setCopied] = useState(false);

  const publisher = story.sourceName ?? "WIZZ News";
  const articleBody = story.content?.trim() || story.summary?.trim();

  async function handleShare() {
    const shareUrl = story.articleUrl || window.location.href;

    try {
      if (navigator.share) {
        await navigator.share({
          title: story.headline,
          text: story.summary || story.headline,
          url: shareUrl,
        });
        return;
      }

      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      console.error("Unable to share this article:", error);
    }
  }

  function handleBookmark() {
    try {
      const saved = JSON.parse(localStorage.getItem(BOOKMARK_KEY) ?? "[]") as string[];
      const next = bookmarked
        ? saved.filter((id) => id !== story.id)
        : [...new Set([...saved, story.id])];

      localStorage.setItem(BOOKMARK_KEY, JSON.stringify(next));
      setBookmarked(!bookmarked);
    } catch (error) {
      console.error("Unable to save this bookmark:", error);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center justify-between">
          <Link
            to="/news"
            search={{ q: "" }}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            <ArrowLeft size={16} />
            Back to News
          </Link>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleShare}
              aria-label="Share article"
              className="grid size-10 place-items-center rounded-full border border-border transition-colors hover:bg-accent"
            >
              {copied ? <Check size={17} /> : <Share2 size={17} />}
            </button>

            <button
              type="button"
              onClick={handleBookmark}
              aria-label={bookmarked ? "Remove bookmark" : "Bookmark article"}
              aria-pressed={bookmarked}
              className={cn(
                "grid size-10 place-items-center rounded-full border border-border transition-colors hover:bg-accent",
                bookmarked && "text-brand",
              )}
            >
              <Bookmark size={17} fill={bookmarked ? "currentColor" : "none"} />
            </button>
          </div>
        </div>

        <article>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand">
            {story.category}
          </p>

          <h1 className="mt-3 text-3xl font-black leading-tight sm:text-4xl">{story.headline}</h1>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{publisher}</span>
            <span aria-hidden="true">·</span>
            <span>{formatPublishedDate(story.createdAt)}</span>
          </div>

          {story.coverImageUrl && (
            <img
              src={story.coverImageUrl}
              alt={story.headline}
              className="mt-6 w-full rounded-2xl object-cover"
              loading="lazy"
            />
          )}

          {articleBody && (
            <div className="mt-6 space-y-4 text-base leading-relaxed text-foreground/90">
              {articleBody.split(/\n+/).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          )}

          {story.articleUrl && (
            <a
              href={story.articleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-background transition-opacity hover:opacity-90"
            >
              Read original at {publisher}
              <ExternalLink size={15} />
            </a>
          )}
        </article>
      </div>
    </main>
  );
}
