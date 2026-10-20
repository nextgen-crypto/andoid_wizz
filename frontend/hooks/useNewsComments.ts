import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSharedRealtimeChannel } from "@/frontend/hooks/realtime";
import { loadNewsComments, type NewsComment } from "@/frontend/hooks/useNewsPrefs";
import { timeAgoCompact } from "@/frontend/lib/format";

function isUuid(v: string | null | undefined): boolean {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

/**
 * News-article comments backed by the news_comments table:
 * one joined query (comment + author), cached briefly, realtime INSERTs
 * stream in while the sheet is open, and a localStorage fallback keeps
 * the thread working offline or on seed-only projects.
 */
export function useNewsComments(articleId: string | null, userId: string | null) {
  const queryClient = useQueryClient();
  const isReal = articleId !== null && isUuid(articleId);
  const key = ["news-comments", articleId, userId];

  const query = useQuery({
    queryKey: key,
    enabled: articleId !== null,
    staleTime: 15_000,
    queryFn: async (): Promise<{ comments: NewsComment[]; live: boolean }> => {
      if (!articleId || !isReal) {
        // Seed/offline thread: keep the localStorage store.
        return { comments: loadNewsComments(articleId ?? ""), live: false };
      }
      try {
        const { data: rows, error } = await supabase
          .from("news_comments")
          .select(
            "id, body, created_at, author_id, parent_id, profiles!news_comments_author_id_fkey(username, display_name, verified)",
          )
          .eq("story_id", articleId)
          .is("parent_id", null)
          .eq("is_deleted", false)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw error;
        const list = (rows ?? []) as {
          id: string;
          body: string;
          created_at: string;
          author_id: string;
          parent_id: string | null;
          profiles: { username: string; display_name: string; verified: boolean } | null;
        }[];
        return {
          live: true,
          comments: list.map((c) => ({
            id: c.id,
            user: c.profiles?.username ?? "someone",
            verified: c.profiles?.verified === true,
            text: c.body,
            time: timeAgoCompact(c.created_at),
            likes: 0,
            ...(c.parent_id ? { parentId: c.parent_id } : {}),
          })),
        };
      } catch {
        return { comments: loadNewsComments(articleId), live: false };
      }
    },
  });

  useSharedRealtimeChannel(articleId && isReal ? `news-comments:${articleId}` : null, (channel) => {
    channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "news_comments",
        filter: `story_id=eq.${articleId}`,
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ["news-comments", articleId] });
      },
    );
  });

  const post = useMutation({
    mutationFn: async (text: string) => {
      if (!articleId) throw new Error("No story selected.");
      const clean = text.trim().slice(0, 2000);
      if (!clean) throw new Error("Write something first.");
      if (!isReal || !userId) {
        // Offline/seed path: append to the local store only.
        const mine: NewsComment = {
          id: `m-${Date.now()}`,
          user: "you",
          verified: false,
          text: clean,
          time: "now",
          likes: 0,
        };
        const next = [mine, ...loadNewsComments(articleId)];
        try {
          localStorage.setItem(
            `wizz:news-comments:${articleId}`,
            JSON.stringify(next.slice(0, 200)),
          );
        } catch {
          // ignore
        }
        return;
      }
      const { error } = await supabase.from("news_comments").insert({
        story_id: articleId,
        article_ref: articleId,
        author_id: userId,
        body: clean,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["news-comments", articleId] });
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    postComment: post.mutate,
    posting: post.isPending,
    postError: post.error,
  };
}
