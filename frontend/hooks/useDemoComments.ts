import { useCallback, useMemo, useState } from "react";

export interface DemoComment {
  id: string;
  user: string;
  text: string;
  time: string;
  likes: number;
  isLiked?: boolean;
  isMine?: boolean;
  parentId?: string | null;
}

const POOL: DemoComment[] = [
  { id: "p1", user: "maya.k", text: "This deserves way more views", time: "2h", likes: 48 },
  { id: "p2", user: "leo.wilder", text: "Instant save. No notes.", time: "4h", likes: 31 },
  { id: "p3", user: "nina.co", text: "The details here are unreal", time: "6h", likes: 22 },
  { id: "p4", user: "sam_films", text: "Watched this three times already", time: "8h", likes: 17 },
  { id: "p5", user: "june", text: "Okay this actually helped me a lot", time: "1d", likes: 12 },
  { id: "p6", user: "riko", text: "First. And worth it.", time: "1d", likes: 9 },
];

function keyFor(postId: string) {
  return `wizz:post-comments:${postId}`;
}

function hash(postId: string): number {
  let h = 0;
  for (const ch of postId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Deterministic preview pick so every demo post shows a first comment. */
export function topDemoComment(postId: string): DemoComment {
  return POOL[hash(postId) % POOL.length]!;
}

// Curated demo comments for the reels/shorts surface, preserved so unifying to
// the one global comments sheet doesn't drop their seeded content.
const CURATED: Record<string, DemoComment[]> = {
  "s-1": [
    {
      id: "c11",
      user: "leo.wilder",
      text: "That drop at 0:12 lives in my head now",
      time: "2h",
      likes: 214,
    },
    { id: "c12", user: "maya.k", text: "Loop number 47 over here", time: "5h", likes: 96 },
    {
      id: "c13",
      user: "nina.co",
      text: "The mix is so clean?? tutorial please",
      time: "1d",
      likes: 41,
    },
  ],
  "s-2": [
    {
      id: "c21",
      user: "sam_films",
      text: "Tried this, actually works. My kitchen survived.",
      time: "1h",
      likes: 88,
    },
    { id: "c22", user: "you", text: "60 seconds is a lie but worth it", time: "3h", likes: 35 },
  ],
  "s-3": [
    { id: "c31", user: "maya.k", text: "Hour nineteen hits different", time: "4h", likes: 57 },
    { id: "c32", user: "riko", text: "Adding this drive to the list", time: "9h", likes: 22 },
  ],
  "s-4": [
    {
      id: "c41",
      user: "leo.wilder",
      text: "That sheet animation is butter",
      time: "2h",
      likes: 31,
    },
  ],
  "s-5": [
    { id: "c51", user: "nina.co", text: "One light supremacy", time: "6h", likes: 44 },
    { id: "c52", user: "june", text: "Saving this for my next shoot", time: "1d", likes: 18 },
  ],
};

/** Deterministic seed comments for a demo post (stable across renders). */
export function seedDemoComments(postId: string): DemoComment[] {
  const curated = CURATED[postId];
  if (curated) return curated;
  const first = topDemoComment(postId);
  const second = topDemoComment(`${postId}:2`);
  return second.id === first.id ? [first] : [second, first];
}

function loadMine(postId: string): DemoComment[] {
  try {
    return JSON.parse(localStorage.getItem(keyFor(postId)) ?? "[]") as DemoComment[];
  } catch {
    return [];
  }
}

function saveMine(postId: string, comments: DemoComment[]) {
  try {
    localStorage.setItem(keyFor(postId), JSON.stringify(comments));
  } catch {
    // ignore
  }
}

/**
 * localStorage-backed comments for demo/seed posts that have no Supabase row.
 * Mirrors the shape of `usePostComments` so the global comments sheet and the
 * feed card agree for demo content. Real posts always use `usePostComments`.
 */
export function useDemoComments(postId: string | null, viewerName: string) {
  const [mine, setMine] = useState<DemoComment[]>(() => (postId ? loadMine(postId) : []));
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set());

  const comments = useMemo(() => {
    if (!postId) return [];
    const seeds = seedDemoComments(postId).map((c) => ({
      ...c,
      isLiked: likedIds.has(c.id),
    }));
    const local = mine.map((c) => ({ ...c, isLiked: likedIds.has(c.id) }));
    // Newest local comments first, then the deterministic seeds.
    return [...local.reverse(), ...seeds];
  }, [postId, mine, likedIds]);

  const total = comments.length;

  const postComment = useCallback(
    (text: string, parentId: string | null = null) => {
      if (!postId) return;
      const clean = text.trim();
      if (!clean) return;
      const next: DemoComment = {
        id: `local-${Date.now()}`,
        user: viewerName || "you",
        text: clean,
        time: "now",
        likes: 0,
        isMine: true,
        parentId,
      };
      const merged = [...mine, next];
      setMine(merged);
      saveMine(postId, merged);
    },
    [postId, mine, viewerName],
  );

  const toggleLike = useCallback((commentId: string) => {
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  }, []);

  const deleteComment = useCallback(
    (commentId: string) => {
      if (!postId) return;
      const merged = mine.filter((c) => c.id !== commentId);
      setMine(merged);
      saveMine(postId, merged);
    },
    [postId, mine],
  );

  return {
    comments,
    total,
    postComment,
    toggleLike,
    deleteComment,
    posting: false,
    postError: null,
    deleting: false,
  };
}
