import { useCallback, useState } from "react";

export interface NewsComment {
  id: string;
  user: string;
  verified: boolean;
  text: string;
  time: string;
  likes: number;
  parentId?: string;
}

function ids(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveIds(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(0, 300)));
  } catch {
    // ignore
  }
}

function commentKey(id: string) {
  return `wizz:news-comments:${id}`;
}

export function loadNewsComments(articleId: string): NewsComment[] {
  try {
    return JSON.parse(localStorage.getItem(commentKey(articleId)) ?? "[]") as NewsComment[];
  } catch {
    return [];
  }
}

/**
 * News taste + discussion, local-first: followed topics/sources, saved
 * stories (+read), likes, reposts, per-article threads with seed voices.
 */
export function useNewsPrefs() {
  const [topics, setTopics] = useState<string[]>(() => ids("wizz:news-topics"));
  const [sources, setSources] = useState<string[]>(() => ids("wizz:news-sources"));
  const [saved, setSaved] = useState<string[]>(() => ids("wizz:news-saved"));
  const [read, setRead] = useState<string[]>(() => ids("wizz:news-read"));
  const [liked, setLiked] = useState<string[]>(() => ids("wizz:news-liked"));
  const [reposted, setReposted] = useState<string[]>(() => ids("wizz:news-reposted"));
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  function toggle(list: string[], key: string, set: (v: string[]) => void, id: string) {
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    saveIds(key, next);
    set(next);
    refresh();
  }

  return {
    topics,
    sources,
    saved,
    read,
    liked,
    reposted,
    toggleTopic: (t: string) => toggle(topics, "wizz:news-topics", setTopics, t.toLowerCase()),
    toggleSource: (s: string) => toggle(sources, "wizz:news-sources", setSources, s.toLowerCase()),
    toggleSaved: (id: string) => toggle(saved, "wizz:news-saved", setSaved, id),
    markRead: (id: string) => {
      if (!read.includes(id)) {
        const next = [...read, id];
        saveIds("wizz:news-read", next);
        setRead(next);
      }
    },
    toggleLiked: (id: string) => toggle(liked, "wizz:news-liked", setLiked, id),
    toggleReposted: (id: string) => toggle(reposted, "wizz:news-reposted", setReposted, id),
    commentsFor: (articleId: string): NewsComment[] => loadNewsComments(articleId),
    postComment: (articleId: string, user: string, text: string, parentId?: string | null) => {
      const comment: NewsComment = {
        id: `m-${Date.now()}`,
        user,
        verified: false,
        text: text.slice(0, 500),
        time: "now",
        likes: 0,
        ...(parentId ? { parentId } : {}),
      };
      const next = [comment, ...loadNewsComments(articleId)];
      try {
        localStorage.setItem(commentKey(articleId), JSON.stringify(next.slice(0, 200)));
      } catch {
        // ignore
      }
      refresh();
    },
    refresh,
  };
}
