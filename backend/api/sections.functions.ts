import { createServerFn } from "@tanstack/react-start";
import { CURRENT_USER_ID, creators, news, shorts, videos } from "../database/seed";
import { cacheAside, TTL } from "../cache/redisCache";
import { serverSupabase } from "../services/feedService";
import type { LongVideo, NewsArticle, ShortVideo } from "../domain/types";

export interface ShortItem {
  short: ShortVideo;
  authorName: string;
  authorUsername: string;
  authorAvatarKey: string;
}

export interface VideoItem {
  video: LongVideo;
  authorName: string;
  authorUsername: string;
  authorAvatarKey: string;
  authorFollowers: number;
  authorVerified: boolean;
}

const byId = new Map(creators.map((c) => [c.id, c]));

const REAL_MEDIA_TTL = 5 * 60;

/** Real user uploads filed as Shorts by the orientation classifier. */
async function realShortItems(): Promise<ShortItem[]> {
  const supabase = serverSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("posts")
    .select(
      "id, author_id, caption, category, video_url, video_path, thumbnail_url, thumbnail_path, created_at, video_width, video_height, comments_count",
    )
    .eq("status", "published")
    .eq("content_kind", "post")
    .eq("content_type", "short")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return []; // Old schemas keep seed-only shorts; never blank.
  return hydrateRealVideoRows(supabase, data as unknown as RealVideoRow[]).then((rows) =>
    rows.map((row) => ({
      short: {
        id: row.id,
        authorId: row.author_id,
        caption: row.caption,
        soundtrack: "Original audio",
        category: row.category || "For You",
        video: {
          kind: "video" as const,
          objectKey: row.videoSrc,
          posterKey: row.posterSrc,
          durationSeconds: 0,
          width: row.video_width ?? 0,
          height: row.video_height ?? 0,
          alt: row.caption,
        },
        metrics: {
          likes: 0,
          comments: row.comments_count ?? 0,
          shares: 0,
          saves: 0,
          views: 0,
        },
      },
      authorName: row.authorName,
      authorUsername: row.authorUsername,
      authorAvatarKey: row.authorAvatarKey,
    })),
  );
}

/** Real user uploads filed as Videos (landscape) by the classifier. */
async function realVideoItems(): Promise<VideoItem[]> {
  const supabase = serverSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("posts")
    .select(
      "id, author_id, caption, category, video_url, video_path, thumbnail_url, thumbnail_path, created_at, video_width, video_height, comments_count",
    )
    .eq("status", "published")
    .eq("content_kind", "post")
    .eq("content_type", "video")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return hydrateRealVideoRows(supabase, data as unknown as RealVideoRow[]).then((rows) =>
    rows.map((row) => ({
      video: {
        id: row.id,
        authorId: row.author_id,
        title: row.caption.slice(0, 80) || "Untitled video",
        description: row.caption,
        category: row.category || "For You",
        tags: [],
        video: {
          kind: "video" as const,
          objectKey: row.videoSrc,
          posterKey: row.posterSrc,
          durationSeconds: 0,
          width: row.video_width ?? 0,
          height: row.video_height ?? 0,
          alt: row.caption,
        },
        views: 0,
        publishedAt: row.created_at,
      },
      authorName: row.authorName,
      authorUsername: row.authorUsername,
      authorAvatarKey: row.authorAvatarKey,
      authorFollowers: 0,
      authorVerified: false,
    })),
  );
}

type RealVideoRow = {
  id: string;
  author_id: string;
  caption: string;
  category: string | null;
  video_url: string | null;
  video_path?: string | null;
  thumbnail_url: string | null;
  thumbnail_path?: string | null;
  created_at: string;
  video_width?: number | null;
  video_height?: number | null;
  comments_count?: number;
};

/** Sign storage paths and resolve author display info for merged rows. */
async function hydrateRealVideoRows(
  supabase: NonNullable<ReturnType<typeof serverSupabase>>,
  rows: RealVideoRow[],
): Promise<
  Array<
    RealVideoRow & {
      videoSrc: string;
      posterSrc: string;
      authorName: string;
      authorUsername: string;
      authorAvatarKey: string;
    }
  >
> {
  const videos = rows;
  const paths = [
    ...new Set(
      videos.flatMap((row) => [row.video_path, row.thumbnail_path].filter(Boolean) as string[]),
    ),
  ];
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const result = await supabase.storage
      .from("post-images")
      .createSignedUrls(paths, REAL_MEDIA_TTL);
    for (const item of result.data ?? []) {
      if (item.path && item.signedUrl && !item.error) signed.set(item.path, item.signedUrl);
    }
  }
  const authorIds = [...new Set(videos.map((row) => row.author_id))];
  const authors = new Map<
    string,
    { display_name: string; username: string; avatar_url: string | null }
  >();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", authorIds);
    for (const p of profiles ?? [])
      authors.set(
        p.id as string,
        p as { display_name: string; username: string; avatar_url: string | null },
      );
  }
  return videos.map((row) => {
    const author = authors.get(row.author_id);
    return {
      ...row,
      caption: row.caption ?? "",
      category: row.category ?? "For You",
      videoSrc: (row.video_path && signed.get(row.video_path)) || row.video_url || "",
      posterSrc: (row.thumbnail_path && signed.get(row.thumbnail_path)) || row.thumbnail_url || "",
      authorName: author?.display_name ?? "WIZZ creator",
      authorUsername: author?.username ?? "wizz",
      authorAvatarKey: author?.avatar_url ?? "",
    };
  });
}

interface StoryRow {
  id: string;
  headline: string;
  summary?: string | null;
  summary_short?: string | null;
  category?: string | null;
  state?: string | null;
  cover_image_url?: string | null;
  created_at: string;
  updated_at?: string | null;
}

const STORY_FULL =
  "id, headline, summary, summary_short, category, state, cover_image_url, created_at, updated_at";
const STORY_MIN = "id, headline, created_at";

/** news_stories select that tolerates projects missing newer columns. */
async function tryStorySelect(supabase: NonNullable<ReturnType<typeof serverSupabase>>) {
  const full = await supabase
    .from("news_stories")
    .select(STORY_FULL)
    .order("created_at", { ascending: false })
    .limit(50);
  if (!full.error) return { data: (full.data ?? null) as unknown[] | null, error: null };
  const msg = String((full.error as { message?: string })?.message ?? full.error);
  if (!/column .* does not exist|schema cache|42P01|PGRST20[45]/i.test(msg)) {
    return { data: null, error: full.error };
  }
  const compat = await supabase
    .from("news_stories")
    .select("id, headline, summary, category, cover_image_url, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (!compat.error) return { data: (compat.data ?? null) as unknown[] | null, error: null };
  const legacy = await supabase
    .from("news_stories")
    .select(STORY_MIN)
    .order("created_at", { ascending: false })
    .limit(50);
  return { data: (legacy.data ?? null) as unknown[] | null, error: legacy.error };
}

function storyToArticle(story: StoryRow, body: string[]): NewsArticle {
  const live = story.state === "live" || story.state === "breaking";
  return {
    id: story.id,
    title: story.headline,
    subheadline: story.summary_short ?? "",
    summary: story.summary ?? "",
    body: body.length > 0 ? body : [story.summary ?? ""],
    sourceName: "WIZZ",
    sourceHandle: "wizz",
    reporter: "WIZZ Newsroom",
    category: story.category || "News",
    url: "",
    imageKey: story.cover_image_url ?? "",
    imageCredit: "",
    publishedAt: story.created_at,
    updatedAt: story.updated_at ?? story.created_at,
    live,
    location: "",
    tags: [story.category || "News"],
    readMinutes: Math.max(1, Math.round((story.summary ?? "").split(/\s+/).length / 180)),
    contentType:
      story.state === "live" ? "breaking" : story.state === "trending" ? "analysis" : "reporting",
    updates: [],
    coverage: [],
  };
}

/** Real stories from news_stories; null means unavailable → seed fallback. */
async function realNewsArticles(): Promise<NewsArticle[] | null> {
  const supabase = serverSupabase();
  if (!supabase) return null;
  const { data, error } = await tryStorySelect(supabase);
  if (error || !data) return null;
  if (data.length === 0) return null;
  const stories = data as StoryRow[];

  // Body paragraphs come from the posts linked to each story.
  const bodies = new Map<string, string[]>();
  const ids = stories.map((s) => s.id);
  const { data: links, error: linksError } = await supabase
    .from("story_posts")
    .select("story_id, posts(caption)")
    .in("story_id", ids)
    .limit(500);
  if (!linksError && links) {
    for (const link of links as unknown as {
      story_id: string;
      posts: { caption: string } | { caption: string }[] | null;
    }[]) {
      const post = Array.isArray(link.posts) ? link.posts[0] : link.posts;
      const caption = post?.caption?.trim();
      if (!caption) continue;
      const list = bodies.get(link.story_id) ?? [];
      if (list.length < 5) list.push(caption);
      bodies.set(link.story_id, list);
    }
  }
  return stories.map((s) => storyToArticle(s, bodies.get(s.id) ?? []));
}

export const fetchNews = createServerFn({ method: "GET" }).handler(async () =>
  cacheAside("news:latest", TTL.trending, async () => {
    const real = await realNewsArticles().catch(() => null);
    if (real && real.length > 0) return real;
    return [...news].sort(
      (a, b) => Number(b.live) - Number(a.live) || b.publishedAt.localeCompare(a.publishedAt),
    );
  }),
);

/** Deterministic discussion volume so sorts are stable without a backend table. */
export function discussionCount(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 120 + (h % 2400);
}

export const fetchArticle = createServerFn({ method: "GET" })
  .validator((data: { articleId?: string } | undefined) => ({
    articleId: data?.articleId ?? "",
  }))
  .handler(async ({ data }): Promise<NewsArticle | null> => {
    if (!data.articleId) return null;
    return cacheAside(`news:article:${data.articleId}`, TTL.news, async () => {
      const real = await realNewsArticles().catch(() => null);
      if (real) {
        const hit = real.find((a) => a.id === data.articleId);
        if (hit) return hit;
      }
      return news.find((a) => a.id === data.articleId) ?? null;
    });
  });

/** Related threads: category + tags + title affinity + live discussion. */
export const fetchRelatedNews = createServerFn({ method: "GET" })
  .validator((data: { articleId?: string } | undefined) => ({
    articleId: data?.articleId ?? "",
  }))
  .handler(async ({ data }): Promise<NewsArticle[]> => {
    if (!data.articleId) return [];
    return cacheAside(`news:related:${data.articleId}`, TTL.news, async () => {
      const real = await realNewsArticles().catch(() => null);
      let pool: NewsArticle[] | null = real !== null && real.length > 0 ? real : null;
      const current =
        pool?.find((a) => a.id === data.articleId) ?? news.find((a) => a.id === data.articleId);
      if (!current) return [];
      if (!pool) pool = news;
      const tags = new Set(current.tags.map((t) => t.toLowerCase()));
      const words = keywords(current.title);
      return pool
        .filter((a) => a.id !== current.id)
        .map((a) => {
          let score = 0;
          if (a.category === current.category) score += 30;
          if (a.sourceName === current.sourceName) score += 10;
          score += Math.min(a.tags.filter((t) => tags.has(t.toLowerCase())).length * 12, 36);
          const w = keywords(a.title);
          let overlap = 0;
          for (const x of w) if (words.has(x)) overlap += 1;
          score += Math.min(overlap * 8, 24);
          score += Math.min(Math.log10(1 + discussionCount(a.id)) * 4, 16);
          return { a, score };
        })
        .sort((x, y) => y.score - x.score)
        .slice(0, 6)
        .map(({ a }) => a);
    });
  });

export interface NewsTopic {
  tag: string;
  articles: number;
  updates: number;
  discussions: number;
}

/** Transparent trending: most discussed, most recent velocity, fastest growing. */
export const fetchNewsTopics = createServerFn({ method: "GET" }).handler(
  async (): Promise<NewsTopic[]> =>
    cacheAside("news:topics", TTL.trending, async () => {
      const real = await realNewsArticles().catch(() => null);
      const pool: NewsArticle[] = real !== null && real.length > 0 ? real : news;
      const byTag = new Map<string, { articles: number; updates: number; discussions: number }>();
      for (const a of pool) {
        for (const t of a.tags) {
          const key = t.toLowerCase();
          const row = byTag.get(key) ?? { articles: 0, updates: 0, discussions: 0 };
          row.articles += 1;
          row.updates += a.updates.length;
          row.discussions += discussionCount(a.id);
          byTag.set(key, row);
        }
      }
      return [...byTag.entries()]
        .map(([tag, v]) => ({ tag, ...v }))
        .sort((a, b) => b.discussions - a.discussions)
        .slice(0, 8);
    }),
);

export const fetchShorts = createServerFn({ method: "GET" }).handler(
  async (): Promise<ShortItem[]> =>
    cacheAside("shorts:rail", TTL.feed, async () => [
      ...(await realShortItems()),
      ...shorts.map((short) => {
        const a = byId.get(short.authorId)!;
        return {
          short,
          authorName: a.displayName,
          authorUsername: a.username,
          authorAvatarKey: a.avatarKey,
        };
      }),
    ]),
);

export const fetchVideos = createServerFn({ method: "GET" }).handler(
  async (): Promise<VideoItem[]> =>
    cacheAside("videos:list", TTL.feed, async () => [
      ...(await realVideoItems()),
      ...videos.map((video) => {
        const a = byId.get(video.authorId)!;
        return {
          video,
          authorName: a.displayName,
          authorUsername: a.username,
          authorAvatarKey: a.avatarKey,
          authorFollowers: a.followers,
          authorVerified: a.verified,
        };
      }),
    ]),
);

function toVideoItem(video: LongVideo): VideoItem {
  const a = byId.get(video.authorId)!;
  return {
    video,
    authorName: a.displayName,
    authorUsername: a.username,
    authorAvatarKey: a.avatarKey,
    authorFollowers: a.followers,
    authorVerified: a.verified,
  };
}

export const fetchVideo = createServerFn({ method: "GET" })
  .validator((data: { videoId?: string } | undefined) => ({ videoId: data?.videoId ?? "" }))
  .handler(async ({ data }): Promise<VideoItem | null> => {
    if (!data.videoId) return null;
    return cacheAside(`video:${data.videoId}`, TTL.feed, async () => {
      const real = await realVideoItems().catch(() => [] as VideoItem[]);
      const hit = real.find((item) => item.video.id === data.videoId);
      if (hit) return hit;
      const video = videos.find((v) => v.id === data.videoId) ?? null;
      return video ? toVideoItem(video) : null;
    });
  });

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "in",
  "on",
  "of",
  "to",
  "you",
  "your",
  "need",
  "with",
  "for",
]);

function keywords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
  );
}

/**
 * Related-video ranker. Balanced so same-channel never auto-dominates:
 * channel and category weigh equally, tags/title/description add affinity,
 * log-views break ties, fresh uploads get a small lift.
 */
export const fetchRelated = createServerFn({ method: "GET" })
  .validator((data: { videoId?: string } | undefined) => ({ videoId: data?.videoId ?? "" }))
  .handler(async ({ data }): Promise<VideoItem[]> => {
    if (!data.videoId) return [];
    return cacheAside(`related:${data.videoId}`, TTL.feed, async () => {
      const allReal = await realVideoItems().catch(() => [] as VideoItem[]);
      const realCurrent = allReal.find((item) => item.video.id === data.videoId) ?? null;
      const otherReal = allReal.filter((item) => item.video.id !== data.videoId);
      const seedCurrent = videos.find((v) => v.id === data.videoId) ?? null;
      const current = seedCurrent ?? realCurrent?.video ?? null;
      if (!current) return [];
      const currentTags = new Set(current.tags.map((t) => t.toLowerCase()));
      const currentTitle = keywords(current.title);
      const currentDesc = keywords(current.description);
      const pool: LongVideo[] = realCurrent
        ? otherReal.map((item) => item.video)
        : videos.filter((v) => v.id !== current.id);
      return pool
        .map((v) => {
          let score = 0;
          if (v.authorId === current.authorId) score += 20;
          if (v.category === current.category) score += 20;
          const sharedTags = v.tags.filter((t) => currentTags.has(t.toLowerCase())).length;
          score += Math.min(sharedTags * 15, 45);
          const words = keywords(v.title);
          let titleOverlap = 0;
          for (const w of words) if (currentTitle.has(w)) titleOverlap += 1;
          score += Math.min(titleOverlap * 15, 30);
          const descWords = keywords(v.description);
          let descOverlap = 0;
          for (const w of descWords) if (currentDesc.has(w)) descOverlap += 1;
          score += Math.min(descOverlap * 2, 10);
          const ageHours = roughAgeHours(v.publishedAt);
          if (ageHours !== null) score += ageHours <= 7 * 24 ? 5 : ageHours <= 30 * 24 ? 2 : 0;
          score += Math.min(Math.log10(1 + v.views) * 2, 14);
          return { video: v, score };
        })
        .sort((a, b) => b.score - a.score)
        .map(({ video }) =>
          realCurrent
            ? (otherReal.find((i) => i.video.id === video.id) ?? toVideoItem(video))
            : toVideoItem(video),
        );
    });
  });

/** Rough parse of seed relative dates ("4 days ago", "1 week ago", ...). */
function roughAgeHours(publishedAt: string): number | null {
  const m = publishedAt.match(/(\d+)\s+(minute|hour|day|week|month)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  const per: Record<string, number> = {
    minute: 1 / 60,
    hour: 1,
    day: 24,
    week: 24 * 7,
    month: 24 * 30,
  };
  return n * (per[unit] ?? 24);
}

export const fetchProfile = createServerFn({ method: "GET" })
  .validator((data: { userId?: string } | undefined) => ({
    userId: data?.userId ?? CURRENT_USER_ID,
  }))
  .handler(async ({ data }) =>
    cacheAside(`profile:${data.userId}`, TTL.profile, async () => {
      const supabase = serverSupabase();
      if (supabase) {
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("id, username, display_name, bio, avatar_url, verified, is_private")
          .eq("id", data.userId)
          .maybeSingle();
        if (!error && profile) {
          const { count } = await supabase
            .from("saves")
            .select("post_id", { count: "exact", head: true })
            .eq("user_id", data.userId);
          const seedMatch = byId.get(data.userId);
          return {
            user: {
              id: profile.id,
              username: profile.username,
              displayName: profile.display_name,
              avatarKey: profile.avatar_url ?? "",
              verified: profile.verified,
              bio: profile.bio ?? "",
              followers: seedMatch?.followers ?? 0,
              following: seedMatch?.following ?? 0,
              posts: seedMatch?.posts ?? 0,
            },
            savedCount: count ?? 0,
            playlists: [],
          };
        }
      }
      return {
        user: byId.get(CURRENT_USER_ID)!,
        savedCount: 128,
        playlists: ["Watch Later", "Cooking ideas", "Travel inspo"],
      };
    }),
  );

export type { NewsArticle };
