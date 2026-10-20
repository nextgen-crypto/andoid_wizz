import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSharedRealtimeChannel } from "@/frontend/hooks/realtime";
import { timeAgoCompact } from "@/frontend/lib/format";

export interface RemoteComment {
  id: string;
  user: string;
  text: string;
  time: string;
  likes: number;
  isLiked: boolean;
  isMine: boolean;
  authorId: string;
  parentId: string | null;
  replyCount: number;
}

function extractTags(text: string): { mentions: string[]; hashtags: string[] } {
  const mentions = [...text.matchAll(/@([\p{L}\p{N}._]+)/gu)].map((m) => m[1]!.toLowerCase());
  const hashtags = [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]!.toLowerCase());
  return {
    mentions: [...new Set(mentions)].slice(0, 5),
    hashtags: [...new Set(hashtags)].slice(0, 5),
  };
}

/**
 * The SINGLE source of truth for a post's comments + comment count.
 * Every surface (feed card, post detail, reels, profile, the global comments
 * sheet) reads this hook so the badge number and the sheet can never disagree.
 *
 * - one joined query (comments + author) with keyset-friendly ordering
 * - one aggregated likes lookup, one viewer-likes lookup
 * - realtime INSERTs stream in while the sheet is open
 * - top-level comments only (`parent_id IS NULL`); replies load lazily
 */
export function usePostComments(postId: string | null, userId: string | null) {
  const queryClient = useQueryClient();
  const key = ["post-comments", postId, userId];

  const query = useQuery({
    queryKey: key,
    enabled: postId !== null,
    staleTime: 15_000,
    queryFn: async (): Promise<{ comments: RemoteComment[]; total: number }> => {
      if (!postId) return { comments: [], total: 0 };
      const { data: rows, error } = await supabase
        .from("comments")
        .select(
          "id, body, created_at, author_id, parent_id, profiles!comments_author_id_fkey(username, display_name)",
        )
        .eq("post_id", postId)
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
        profiles: { username: string; display_name: string } | null;
      }[];
      const ids = list.map((c) => c.id);
      const likeCount = new Map<string, number>();
      const likedByMe = new Set<string>();
      const replyCount = new Map<string, number>();
      if (ids.length > 0) {
        const [likesRes, mineRes, repliesRes] = await Promise.all([
          supabase.from("comment_likes").select("comment_id").in("comment_id", ids),
          userId
            ? supabase
                .from("comment_likes")
                .select("comment_id")
                .eq("user_id", userId)
                .in("comment_id", ids)
            : Promise.resolve({ data: [] as never[] }),
          supabase
            .from("comments")
            .select("parent_id")
            .in("parent_id", ids)
            .eq("is_deleted", false),
        ]);
        for (const l of (likesRes.data ?? []) as { comment_id: string }[]) {
          likeCount.set(l.comment_id, (likeCount.get(l.comment_id) ?? 0) + 1);
        }
        for (const l of (mineRes.data ?? []) as { comment_id: string }[]) {
          likedByMe.add(l.comment_id);
        }
        for (const r of (repliesRes.data ?? []) as { parent_id: string }[]) {
          replyCount.set(r.parent_id, (replyCount.get(r.parent_id) ?? 0) + 1);
        }
      }
      const comments: RemoteComment[] = list.map((c) => ({
        id: c.id,
        user: c.profiles?.username ?? "someone",
        text: c.body,
        time: timeAgoCompact(c.created_at),
        likes: likeCount.get(c.id) ?? 0,
        isLiked: likedByMe.has(c.id),
        isMine: userId !== null && c.author_id === userId,
        authorId: c.author_id,
        parentId: c.parent_id,
        replyCount: replyCount.get(c.id) ?? 0,
      }));
      const { count } = await supabase
        .from("comments")
        .select("id", { count: "exact", head: true })
        .eq("post_id", postId)
        .is("parent_id", null)
        .eq("is_deleted", false);
      return { comments, total: count ?? comments.length };
    },
  });

  useSharedRealtimeChannel(postId ? `comments:${postId}` : null, (channel) => {
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "comments", filter: `post_id=eq.${postId}` },
      () => {
        void queryClient.invalidateQueries({ queryKey: ["post-comments", postId] });
        void queryClient.invalidateQueries({ queryKey: ["comment-replies"] });
      },
    );
  });

  const post = useMutation({
    mutationFn: async ({ text, parentId }: { text: string; parentId?: string | null }) => {
      if (!postId || !userId) throw new Error("Sign in to comment.");
      const clean = text.trim().slice(0, 1000);
      if (!clean) throw new Error("Write something first.");
      const { mentions, hashtags } = extractTags(clean);
      const { error } = await supabase.from("comments").insert({
        post_id: postId,
        author_id: userId,
        body: clean,
        parent_id: parentId ?? null,
        metadata: { client: "web", mentions, hashtags },
      });
      if (error) throw error;
    },
    // Optimistic top-level add: prepend a temp comment so it appears instantly,
    // then roll back on error (the sheet surfaces the rollback as a toast).
    onMutate: async ({ text, parentId }) => {
      if (parentId || !postId) return {};
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<{ comments: RemoteComment[]; total: number }>(key);
      const optimistic: RemoteComment = {
        id: `optimistic-${Date.now()}`,
        user: "you",
        text: text.trim().slice(0, 1000),
        time: "now",
        likes: 0,
        isLiked: false,
        isMine: true,
        authorId: userId ?? "",
        parentId: null,
        replyCount: 0,
      };
      queryClient.setQueryData<{ comments: RemoteComment[]; total: number }>(key, (old) => ({
        comments: [optimistic, ...(old?.comments ?? [])],
        total: (old?.total ?? 0) + 1,
      }));
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["post-comments", postId] });
      void queryClient.invalidateQueries({ queryKey: ["comment-replies"] });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["post-comments", postId] });
    },
  });

  const toggleLike = useMutation({
    mutationFn: async ({ commentId, like }: { commentId: string; like: boolean }) => {
      if (!userId) throw new Error("Sign in to like comments.");
      if (like) {
        const { error } = await supabase
          .from("comment_likes")
          .insert({ user_id: userId, comment_id: commentId });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("comment_likes")
          .delete()
          .eq("user_id", userId)
          .eq("comment_id", commentId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["post-comments", postId] });
      void queryClient.invalidateQueries({ queryKey: ["comment-replies"] });
    },
  });

  // Soft-delete: the schema models `is_deleted`, and the list queries already
  // filter it out. RLS decides whether the viewer may update the row (author,
  // or an admin/moderator policy), so we never bypass permissions here.
  const remove = useMutation({
    mutationFn: async (commentId: string) => {
      if (!userId) throw new Error("Sign in to delete comments.");
      const { error } = await supabase
        .from("comments")
        .update({ is_deleted: true })
        .eq("id", commentId)
        .eq("author_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["post-comments", postId] });
      void queryClient.invalidateQueries({ queryKey: ["comment-replies"] });
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    postComment: post.mutate,
    posting: post.isPending,
    postError: post.error,
    toggleLike: toggleLike.mutate,
    deleting: remove.isPending,
    deleteComment: remove.mutate,
  };
}

/** Lazily-load the replies for one top-level comment ("View N replies"). */
export function useCommentReplies(
  commentId: string | null,
  userId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["comment-replies", commentId, userId],
    enabled: commentId !== null && enabled,
    staleTime: 15_000,
    queryFn: async () => {
      if (!commentId) return [];
      const { data, error } = await supabase
        .from("comments")
        .select(
          "id, body, created_at, author_id, profiles!comments_author_id_fkey(username, display_name)",
        )
        .eq("parent_id", commentId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      const rows = (data ?? []) as {
        id: string;
        body: string;
        created_at: string;
        author_id: string;
        profiles: { username: string; display_name: string } | null;
      }[];
      const ids = rows.map((r) => r.id);
      const likeCount = new Map<string, number>();
      const likedByMe = new Set<string>();
      if (ids.length > 0) {
        const [likesRes, mineRes] = await Promise.all([
          supabase.from("comment_likes").select("comment_id").in("comment_id", ids),
          userId
            ? supabase
                .from("comment_likes")
                .select("comment_id")
                .eq("user_id", userId)
                .in("comment_id", ids)
            : Promise.resolve({ data: [] as never[] }),
        ]);
        for (const l of (likesRes.data ?? []) as { comment_id: string }[]) {
          likeCount.set(l.comment_id, (likeCount.get(l.comment_id) ?? 0) + 1);
        }
        for (const l of (mineRes.data ?? []) as { comment_id: string }[]) {
          likedByMe.add(l.comment_id);
        }
      }
      return rows.map((r) => ({
        id: r.id,
        user: r.profiles?.username ?? "someone",
        text: r.body,
        time: timeAgoCompact(r.created_at),
        likes: likeCount.get(r.id) ?? 0,
        isLiked: likedByMe.has(r.id),
        isMine: userId !== null && r.author_id === userId,
        authorId: r.author_id,
      }));
    },
  });
}
