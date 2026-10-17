import { Link } from "@tanstack/react-router";
import type { NewsStory } from "@/frontend/hooks/useNewsStories";
import { formatCount, newsTimeAgo } from "@/frontend/components/news/newsFormat";
import { cn } from "@/lib/utils";

function stateTone(state: NewsStory["state"]): string {
  if (state === "breaking" || state === "live") return "text-live";
  if (state === "trending") return "text-brand";
  return "text-muted-foreground";
}

/** External (GNews) stories carry an article URL; internal ones link to a thread. */
function isExternalStory(story: NewsStory): boolean {
  return Boolean(story.articleUrl);
}

/**
 * Screen 1 story row: overlapping source avatars, wrapping headline,
 * `{time} · {category} · {N} posts` meta, optional state label. Flat row.
 *
 * External stories show the publisher name + summary instead of a post count.
 */
export function StoryListItem({ story }: { story: NewsStory }) {
  const words = story.headline.split(/\s+/).filter(Boolean);
  const marks = [
    words[0]?.slice(0, 1) ?? "N",
    words[1]?.slice(0, 1) ?? story.category.slice(0, 1),
  ].map((c) => c.toUpperCase());
  const external = isExternalStory(story);
  return (
    <Link
      to="/news/$articleId"
      params={{ articleId: story.id }}
      search={{ q: "" }}
      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      aria-label={`Read ${story.headline}`}
    >
      {/* Left column — source marks, headline, summary, meta. */}
      <div className="min-w-0 flex-1">
        <span className="flex items-center" aria-hidden="true">
          {marks.map((ch, i) => (
            <span
              key={i}
              className="-ml-1 grid size-5 place-items-center rounded-full bg-secondary text-[9px] font-black text-foreground ring-2 ring-background first:ml-0"
            >
              {ch}
            </span>
          ))}
        </span>
        <h3 className="mt-1.5 text-[15px] font-bold leading-snug text-foreground">
          {story.headline}
        </h3>
        {(story.summaryShort || story.summary) && (
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {story.summaryShort || story.summary}
          </p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <span>{newsTimeAgo(story.createdAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{story.category}</span>
          <span aria-hidden="true">·</span>
          {external ? (
            <span className="font-medium text-brand">{story.sourceName || "External source"}</span>
          ) : (
            <span>{formatCount(story.postCount)} posts</span>
          )}
          <span className={cn("font-bold uppercase tracking-wider", stateTone(story.state))}>
            · {story.state}
          </span>
        </p>
      </div>

      {/* Right column — X-style thumbnail. Only rendered when the story has a
          cover image, so image-less rows keep their full-width text layout. */}
      {story.coverImageUrl && (
        <img
          src={story.coverImageUrl}
          alt=""
          loading="lazy"
          className="mt-1 size-20 shrink-0 rounded-xl object-cover sm:size-24"
        />
      )}
    </Link>
  );
}
