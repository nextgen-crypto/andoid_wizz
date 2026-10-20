import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Newspaper,
  Plus,
  Trash2,
  RefreshCw,
  Eye,
  Edit2,
  Check,
  X,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  adminCreateTrendingTopic,
  adminDeleteNewsStory,
  adminDeleteTrendingTopic,
  adminSaveNewsStory,
} from "@/backend/api/admin.functions";
import { toast } from "sonner";
import { useSession } from "@/frontend/hooks/useSession";
import { Badge, Empty, Panel } from "@/frontend/components/admin/ui";
import { formatCount } from "@/frontend/components/news/newsFormat";
import { cn } from "@/lib/utils";

interface NewsStory {
  id: string;
  headline: string;
  summary: string;
  category: string;
  state: string;
  cover_image_url: string | null;
  created_at: string;
  postCount: number;
}

interface TrendingTopic {
  id: string;
  label: string;
  context: string;
  post_count: number;
  rank: number;
}

export function NewsAdminSection() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"stories" | "trending" | "create">("stories");
  const [editingStory, setEditingStory] = useState<NewsStory | null>(null);
  const [storyForm, setStoryForm] = useState({
    headline: "",
    summary: "",
    category: "General",
    state: "developing",
  });
  const [topicForm, setTopicForm] = useState({ label: "", context: "", post_count: 0 });
  const [creatingTopic, setCreatingTopic] = useState(false);

  const storiesQuery = useQuery({
    queryKey: ["admin-news-stories"],
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("news_stories")
        .select("id, headline, summary, category, state, cover_image_url, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const ids = (data ?? []).map((s: { id: string }) => s.id);
      const counts = new Map<string, number>();
      if (ids.length > 0) {
        const { data: links } = await supabase
          .from("story_posts")
          .select("story_id")
          .in("story_id", ids)
          .limit(2000);
        for (const l of (links ?? []) as { story_id: string }[])
          counts.set(l.story_id, (counts.get(l.story_id) ?? 0) + 1);
      }
      return (data ?? []).map(
        (s: {
          id: string;
          headline: string;
          summary: string | null;
          category: string | null;
          state: string | null;
          cover_image_url: string | null;
          created_at: string;
        }) => ({ ...s, postCount: counts.get(s.id) ?? 0 }),
      ) as NewsStory[];
    },
  });

  const topicsQuery = useQuery({
    queryKey: ["admin-trending-topics"],
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trending_topics")
        .select("id, label, context, post_count, rank")
        .order("rank", { ascending: true })
        .limit(20);
      if (error) throw error;
      return data as TrendingTopic[];
    },
  });

  // Reads stay on the browser client (news_stories / trending_topics have a
  // public SELECT policy); every write goes through an admin-gated
  // server function because the tables ship SELECT-only RLS — direct
  // browser writes always failed with an RLS violation.
  const createStoryMutation = useMutation({
    mutationFn: async () => {
      await adminSaveNewsStory({
        data: {
          headline: storyForm.headline,
          summary: storyForm.summary,
          category: storyForm.category,
          state: storyForm.state,
        },
      });
      setStoryForm({ headline: "", summary: "", category: "General", state: "developing" });
      setActiveTab("stories");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-news-stories"] });
      toast("Story created.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create story."),
  });

  const deleteStoryMutation = useMutation({
    mutationFn: async (id: string) => {
      await adminDeleteNewsStory({ data: { id } });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-news-stories"] });
      toast("Story deleted.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete."),
  });

  const updateStoryMutation = useMutation({
    mutationFn: async (story: NewsStory) => {
      await adminSaveNewsStory({
        data: {
          id: story.id,
          headline: story.headline,
          summary: story.summary,
          category: story.category,
          state: story.state,
        },
      });
      setEditingStory(null);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-news-stories"] });
      toast("Story updated.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update."),
  });

  const createTopicMutation = useMutation({
    mutationFn: async () => {
      await adminCreateTrendingTopic({
        data: {
          label: topicForm.label,
          context: topicForm.context,
          postCount: topicForm.post_count,
        },
      });
      setTopicForm({ label: "", context: "", post_count: 0 });
      setCreatingTopic(false);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-trending-topics"] });
      toast("Topic created.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create topic."),
  });

  const deleteTopicMutation = useMutation({
    mutationFn: async (id: string) => {
      await adminDeleteTrendingTopic({ data: { id } });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-trending-topics"] });
      toast("Topic deleted.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete."),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Newspaper className="size-5 text-brand" />
        <h2 className="text-lg font-bold text-foreground">News Management</h2>
        <div className="ml-auto flex gap-1">
          {(["stories", "trending", "create"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-bold capitalize",
                activeTab === t
                  ? "bg-foreground text-background"
                  : "bg-secondary text-foreground hover:bg-secondary/80",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "stories" && (
        <Panel title={`Stories (${storiesQuery.data?.length ?? 0})`}>
          {storiesQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-secondary" />
              ))}
            </div>
          ) : storiesQuery.data?.length === 0 ? (
            <Empty text="No stories yet — create one." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 pr-3">Headline</th>
                    <th className="pb-2 pr-3">Category</th>
                    <th className="pb-2 pr-3">State</th>
                    <th className="pb-2 pr-3">Posts</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {storiesQuery.data?.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2 pr-3">
                        <span className="font-semibold text-foreground">{s.headline}</span>
                        <span className="block text-xs text-muted-foreground">
                          {new Date(s.created_at).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge>{s.category}</Badge>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge
                          tone={
                            s.state === "breaking"
                              ? "red"
                              : s.state === "trending"
                                ? "brand"
                                : "gray"
                          }
                        >
                          {s.state}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3">{formatCount(s.postCount)}</td>
                      <td className="py-2">
                        <div className="flex gap-1">
                          <button
                            onClick={() => {
                              setEditingStory(s);
                              setStoryForm({
                                headline: s.headline,
                                summary: s.summary,
                                category: s.category,
                                state: s.state,
                              });
                            }}
                            aria-label="Edit"
                            className="rounded-lg p-1.5 hover:bg-secondary"
                          >
                            <Edit2 className="size-4" />
                          </button>
                          <button
                            onClick={() => deleteStoryMutation.mutate(s.id)}
                            aria-label="Delete"
                            className="rounded-lg p-1.5 text-live hover:bg-secondary"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {activeTab === "trending" && (
        <Panel
          title={`Trending Topics (${topicsQuery.data?.length ?? 0})`}
          right={
            <button
              onClick={() => setCreatingTopic(true)}
              className="flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground"
            >
              <Plus className="size-3.5" /> Add
            </button>
          }
        >
          {creatingTopic && (
            <div className="mb-3 space-y-2 rounded-xl border border-border p-3">
              <input
                value={topicForm.label}
                onChange={(e) => setTopicForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Topic label (e.g. #Tanzania)"
                className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm outline-none"
              />
              <input
                value={topicForm.context}
                onChange={(e) => setTopicForm((f) => ({ ...f, context: e.target.value }))}
                placeholder="Context (e.g. Tanzania)"
                className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => createTopicMutation.mutate()}
                  disabled={!topicForm.label.trim()}
                  className="rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-brand-foreground disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => setCreatingTopic(false)}
                  className="rounded-full bg-secondary px-4 py-1.5 text-xs font-bold"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {topicsQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-xl bg-secondary" />
              ))}
            </div>
          ) : topicsQuery.data?.length === 0 ? (
            <Empty text="No trending topics yet." />
          ) : (
            <div className="divide-y divide-border">
              {topicsQuery.data?.map((t) => (
                <div key={t.id} className="flex items-center gap-3 py-2">
                  <span className="grid size-8 place-items-center rounded-full bg-secondary text-xs font-bold">
                    #{t.rank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-foreground">
                      {t.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t.context} · {formatCount(t.post_count)} posts
                    </span>
                  </span>
                  <button
                    onClick={() => deleteTopicMutation.mutate(t.id)}
                    aria-label="Delete"
                    className="rounded-lg p-1.5 text-live hover:bg-secondary"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {activeTab === "create" && (
        <Panel title="Create Story">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-muted-foreground">Headline</label>
              <input
                value={storyForm.headline}
                onChange={(e) => setStoryForm((f) => ({ ...f, headline: e.target.value }))}
                placeholder="Breaking: ..."
                className="w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-muted-foreground">Summary</label>
              <textarea
                value={storyForm.summary}
                onChange={(e) => setStoryForm((f) => ({ ...f, summary: e.target.value }))}
                rows={4}
                placeholder="Brief summary of the story..."
                className="w-full resize-none rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-muted-foreground">
                  Category
                </label>
                <select
                  value={storyForm.category}
                  onChange={(e) => setStoryForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm outline-none"
                >
                  {[
                    "General",
                    "Politics",
                    "Business",
                    "Technology",
                    "Sports",
                    "Entertainment",
                    "Health",
                    "Science",
                    "World",
                    "Africa",
                    "Tanzania",
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-muted-foreground">State</label>
                <select
                  value={storyForm.state}
                  onChange={(e) => setStoryForm((f) => ({ ...f, state: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm outline-none"
                >
                  {["breaking", "developing", "trending", "live", "updated", "archived"].map(
                    (s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>
            <button
              onClick={() => createStoryMutation.mutate()}
              disabled={!storyForm.headline.trim() || createStoryMutation.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-brand py-2.5 text-sm font-bold text-brand-foreground disabled:opacity-50"
            >
              {createStoryMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {createStoryMutation.isPending ? "Creating..." : "Create Story"}
            </button>
          </div>
        </Panel>
      )}

      {editingStory && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setEditingStory(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-foreground">Edit Story</h3>
            <div className="mt-3 space-y-3">
              <input
                value={editingStory.headline}
                onChange={(e) => setEditingStory({ ...editingStory, headline: e.target.value })}
                className="w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm outline-none"
              />
              <textarea
                value={editingStory.summary}
                onChange={(e) => setEditingStory({ ...editingStory, summary: e.target.value })}
                rows={3}
                className="w-full resize-none rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm outline-none"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={editingStory.category}
                  onChange={(e) => setEditingStory({ ...editingStory, category: e.target.value })}
                  className="rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm outline-none"
                >
                  {[
                    "General",
                    "Politics",
                    "Business",
                    "Technology",
                    "Sports",
                    "Entertainment",
                    "Health",
                    "Science",
                    "World",
                    "Africa",
                    "Tanzania",
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select
                  value={editingStory.state}
                  onChange={(e) => setEditingStory({ ...editingStory, state: e.target.value })}
                  className="rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm outline-none"
                >
                  {["breaking", "developing", "trending", "live", "updated", "archived"].map(
                    (s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => updateStoryMutation.mutate(editingStory)}
                  className="flex-1 rounded-full bg-brand py-2.5 text-sm font-bold text-brand-foreground"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingStory(null)}
                  className="flex-1 rounded-full bg-secondary py-2.5 text-sm font-bold"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
