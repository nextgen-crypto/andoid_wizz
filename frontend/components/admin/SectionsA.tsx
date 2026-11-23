import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAdminReports,
  resolveAdminReport,
  type ResolveAction,
} from "@/backend/api/admin.functions";
import {
  fetchAdminCreators,
  adminSetPostStatus,
  type AdminCreator,
} from "@/backend/api/admin-console";
import { TRACKS } from "@/frontend/components/create/creationEngine";
import { Badge, Empty, Field, Panel, Select, inputCls } from "@/frontend/components/admin/ui";
import { exportCsv, newId, type ActFn, type OpStore } from "@/frontend/components/admin/opStore";
import type { AdminMetrics } from "@/frontend/hooks/useAdminMetrics";
import { useSession } from "@/frontend/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/frontend/lib/format";
import { toast } from "sonner";

export interface SectionProps {
  m: AdminMetrics | null;
  ops: OpStore;
  act: ActFn;
  email: string;
}

const tz = (n: number) => `TZS ${n.toLocaleString()}`;

/* ---------------------------------------------------------- CONTENT */

type ContentTab =
  "posts" | "videos" | "shorts" | "stories" | "news" | "comments" | "tags" | "audio" | "live";

const CONTENT_TABS: ContentTab[] = [
  "posts",
  "videos",
  "shorts",
  "stories",
  "news",
  "comments",
  "tags",
  "audio",
  "live",
];

type ContentRow = {
  id: string;
  caption: string;
  category: string;
  created_at: string;
  author_id: string;
  status: string;
  content_kind: string;
  content_type: string;
};

type NewsRow = {
  id: string;
  headline: string;
  category: string;
  state: string;
  created_at: string;
};

/** Live rows from `posts` — the same table the feed reads, so what the
 *  console lists is what users actually see (seed data never was). */
async function fetchPostsWhere(pairs: [string, string][], limit = 50): Promise<ContentRow[]> {
  let q = supabase
    .from("posts")
    .select("id, caption, category, created_at, author_id, status, content_kind, content_type")
    .neq("status", "deleted")
    .order("created_at", { ascending: false })
    .limit(limit);
  for (const [col, val] of pairs) q = q.eq(col, val);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ContentRow[];
}

export function ContentSection({ m, ops, act }: SectionProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ContentTab>("posts");
  const [busyId, setBusyId] = useState<string | null>(null);

  const postsQ = useQuery({
    queryKey: ["admin-content", "posts"],
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      fetchPostsWhere([
        ["content_kind", "post"],
        ["content_type", ""],
      ]),
  });
  const videosQ = useQuery({
    queryKey: ["admin-content", "videos"],
    staleTime: 30_000,
    retry: false,
    queryFn: () => fetchPostsWhere([["content_type", "video"]]),
  });
  const shortsQ = useQuery({
    queryKey: ["admin-content", "shorts"],
    staleTime: 30_000,
    retry: false,
    queryFn: () => fetchPostsWhere([["content_type", "short"]]),
  });
  const storiesQ = useQuery({
    queryKey: ["admin-content", "stories"],
    staleTime: 30_000,
    retry: false,
    queryFn: () => fetchPostsWhere([["content_kind", "story"]]),
  });
  const newsQ = useQuery({
    queryKey: ["admin-content", "news"],
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("news_stories")
        .select("id, headline, category, state, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as NewsRow[];
    },
  });
  const { data: commentsProbe } = useQuery({
    queryKey: ["admin-comments-probe"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("comments")
        .select("id, body, created_at, author_id")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as { id: string; body: string; created_at: string; author_id: string }[];
    },
    retry: false,
  });
  const names = new Map((m?.users ?? []).map((u) => [u.id, u.username]));
  const isHidden = (row: ContentRow) =>
    row.status !== "published" || ops.hidden.some((h) => h.kind === "post" && h.refId === row.id);

  /** Hide = archive server-side, which drops the post out of every feed for
   *  every user; Restore puts it back. The old button only wrote to this
   *  browser's localStorage, so it never hid anything. */
  async function toggleVisibility(row: ContentRow, key: unknown[]) {
    const hide = row.status === "published";
    setBusyId(row.id);
    try {
      await adminSetPostStatus({ data: { id: row.id, status: hide ? "archived" : "published" } });
      act(hide ? "Hide post" : "Restore post", row.id.slice(0, 8), (s) => ({
        ...s,
        hidden: hide
          ? [...s.hidden, { kind: "post", refId: row.id, reason: "admin hide" }]
          : s.hidden.filter((h) => h.refId !== row.id),
      }));
      await queryClient.invalidateQueries({ queryKey: key });
      toast.success(hide ? "Hidden from every feed." : "Restored to every feed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update that post.");
    } finally {
      setBusyId(null);
    }
  }

  function renderRows(rows: ContentRow[], key: unknown[]) {
    if (rows.length === 0) return <Empty text="Nothing here yet." />;
    return (
      <ul className="divide-y divide-border">
        {rows.map((p) => {
          const hidden = isHidden(p);
          return (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">
                  {p.caption.slice(0, 80) || "Photo post"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  @{names.get(p.author_id) ?? "?"} ·{" "}
                  {p.content_kind === "story" ? "story" : p.content_type || p.category || "post"} ·{" "}
                  {timeAgo(p.created_at)}
                </span>
              </span>
              {hidden && <Badge tone="red">hidden</Badge>}
              <button
                onClick={() => void toggleVisibility(p, key)}
                disabled={busyId === p.id}
                className="shrink-0 rounded-full bg-secondary px-3 py-1.5 text-xs font-bold disabled:opacity-50"
              >
                {busyId === p.id ? "…" : hidden ? "Restore" : "Hide"}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  function loading(q: { isLoading: boolean; isError: boolean; error: unknown }) {
    if (q.isLoading) return <Empty text="Loading live content…" />;
    if (q.isError)
      return (
        <Empty
          text={`Could not load: ${q.error instanceof Error ? q.error.message : "query failed"}`}
        />
      );
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {CONTENT_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full px-4 py-2 text-xs font-bold capitalize",
              tab === t
                ? "bg-foreground text-background"
                : "bg-card text-muted-foreground border border-border",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "posts" && (
        <Panel
          title={`Posts (${postsQ.data?.length ?? 0})`}
          hint="Live from the posts table · latest 50"
        >
          {loading(postsQ) ?? renderRows(postsQ.data ?? [], ["admin-content", "posts"])}
        </Panel>
      )}

      {tab === "videos" && (
        <Panel title={`Videos (${videosQ.data?.length ?? 0})`} hint="Live · posts with a video">
          {loading(videosQ) ?? renderRows(videosQ.data ?? [], ["admin-content", "videos"])}
        </Panel>
      )}

      {tab === "shorts" && (
        <Panel title={`Shorts (${shortsQ.data?.length ?? 0})`} hint="Live · posts marked as shorts">
          {loading(shortsQ) ?? renderRows(shortsQ.data ?? [], ["admin-content", "shorts"])}
        </Panel>
      )}

      {tab === "stories" && (
        <Panel title={`Stories (${storiesQ.data?.length ?? 0})`} hint="Live · story posts">
          {loading(storiesQ) ?? renderRows(storiesQ.data ?? [], ["admin-content", "stories"])}
        </Panel>
      )}

      {tab === "news" && (
        <Panel
          title={`News (${newsQ.data?.length ?? 0})`}
          hint="Live from news_stories · publish, edit and remove in News"
        >
          {loading(newsQ) ??
            ((newsQ.data ?? []).length === 0 ? (
              <Empty text="No stories yet — add one in News." />
            ) : (
              <ul className="divide-y divide-border">
                {(newsQ.data ?? []).map((n) => (
                  <li key={n.id} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{n.headline}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {n.category} · {n.state} · {timeAgo(n.created_at)}
                      </span>
                    </span>
                    <Badge tone={n.state === "breaking" ? "red" : "gray"}>{n.state}</Badge>
                  </li>
                ))}
              </ul>
            ))}
        </Panel>
      )}

      {tab === "comments" && (
        <Panel
          title="Comments"
          hint={commentsProbe ? "Live from Supabase" : "Migration not applied yet"}
        >
          {!commentsProbe ? (
            <Empty text="Run the comments migration in Supabase to moderate live comments." />
          ) : commentsProbe.length === 0 ? (
            <Empty text="No comments yet." />
          ) : (
            <ul className="divide-y divide-border">
              {commentsProbe.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{c.body.slice(0, 90)}</span>
                    <span className="text-[11px] text-muted-foreground">
                      @{names.get(c.author_id) ?? "?"} · {timeAgo(c.created_at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === "tags" && (
        <Panel title="Hashtags" hint="From the last 1000 posts">
          <div className="flex flex-wrap gap-1.5">
            {(m?.hashtags ?? []).map((h) => (
              <span
                key={h.tag}
                className="rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold"
              >
                #{h.tag} · {h.count}
              </span>
            ))}
            {(m?.hashtags ?? []).length === 0 && <Empty text="No hashtags yet." />}
          </div>
        </Panel>
      )}

      {tab === "audio" && (
        <Panel title={`Audio (${TRACKS.length})`} hint="In-app sound library">
          <ul className="divide-y divide-border">
            {TRACKS.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{t.title}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {t.creator} · {t.duration}
                  </span>
                </span>
                <Badge>{t.id === "t5" ? "original" : "licensed"}</Badge>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {tab === "live" && (
        <Panel title="Live streams" hint="Rooms are local mock sessions for now">
          <Empty text="No live rooms right now. Blend rooms appear here when realtime rooms land." />
        </Panel>
      )}
    </div>
  );
}

/* -------------------------------------------------------- MODERATION */
const REASONS = [
  "Spam",
  "Harassment",
  "Hate speech",
  "Violence",
  "Nudity",
  "Copyright",
  "Impersonation",
  "Other",
];

function isUuidLike(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Live moderation queue (Supabase reports). Falls back to the local demo queue. */
export function ModerationSection({ m, ops, act, email }: SectionProps) {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-reports-live"],
    queryFn: () => fetchAdminReports(),
    staleTime: 15_000,
    retry: false,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Panel title="Moderation queue">
        <Empty text="Loading live reports…" />
      </Panel>
    );
  }
  if (!data || data.live === false) {
    return <ModerationLocalSection m={m} ops={ops} act={act} email={email} />;
  }

  const reports = data.reports;
  const pending = reports.filter((r) => r.status === "pending");

  async function resolve(id: string, action: ResolveAction) {
    setBusyId(id);
    setError(null);
    try {
      const res = await resolveAdminReport({ data: { id, action } });
      await queryClient.invalidateQueries({ queryKey: ["admin-reports-live"] });
      act(`Moderate: ${action}`, `${id} — ${res.detail}`, (s) => s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resolve failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat2 label="Pending" value={`${pending.length}`} alert={pending.length > 0} />
        <Stat2 label="Source" value="Supabase live" />
        <Stat2
          label="Resolved"
          value={`${reports.filter((r) => r.status === "resolved").length}`}
        />
      </div>
      <Panel
        title={`Moderation queue (${pending.length} pending)`}
        hint="Review → approve, remove, delete, warn, restrict, suspend"
      >
        {error && <p className="mb-2 text-xs font-semibold text-live">{error}</p>}
        {reports.length === 0 ? (
          <Empty text="Queue is clear." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-3">Content</th>
                  <th className="pb-2 pr-3">Reason</th>
                  <th className="pb-2 pr-3">Reporter</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reports.map((r) => {
                  const realUser = isUuidLike(r.target_user_id ?? "");
                  const busy = busyId === r.id;
                  return (
                    <tr key={r.id}>
                      <td className="py-2 pr-3">
                        <p className="font-semibold">{r.ref_title || r.ref_id.slice(0, 12)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {r.kind} · {new Date(r.created_at).toLocaleString()}
                        </p>
                        {r.resolution && (
                          <p className="text-[11px] text-muted-foreground">→ {r.resolution}</p>
                        )}
                      </td>
                      <td className="py-2 pr-3">{r.reason}</td>
                      <td className="py-2 pr-3 text-muted-foreground">@{r.reporter_name}</td>
                      <td className="py-2 pr-3">
                        <Badge tone={r.status === "pending" ? "red" : "gray"}>{r.status}</Badge>
                      </td>
                      <td className="py-2">
                        {r.status === "resolved" ? (
                          <span className="text-xs text-muted-foreground">done</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            <ModBtn
                              label={busy ? "…" : "Approve"}
                              onClick={() => void resolve(r.id, "approve")}
                            />
                            <ModBtn
                              label="Remove"
                              danger
                              onClick={() => void resolve(r.id, "remove_content")}
                            />
                            <ModBtn
                              label="Delete"
                              danger
                              onClick={() => void resolve(r.id, "delete_content")}
                            />
                            <ModBtn
                              label="Warn"
                              disabled={!realUser}
                              onClick={() => void resolve(r.id, "warn")}
                            />
                            <ModBtn
                              label="Restrict"
                              danger
                              disabled={!realUser}
                              onClick={() => void resolve(r.id, "restrict")}
                            />
                            <ModBtn
                              label="Suspend"
                              danger
                              disabled={!realUser}
                              onClick={() => void resolve(r.id, "suspend")}
                            />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {user && (
        <FileReportForm
          userId={user.id}
          onFiled={() => {
            void queryClient.invalidateQueries({ queryKey: ["admin-reports-live"] });
            act("File report (admin)", "manual", (s) => s);
          }}
        />
      )}
    </div>
  );
}

function FileReportForm({ userId, onFiled }: { userId: string; onFiled: () => void }) {
  const [kind, setKind] = useState("post");
  const [refId, setRefId] = useState("");
  const [reason, setReason] = useState(REASONS[0]!);
  const [error, setError] = useState<string | null>(null);

  async function file() {
    if (!refId.trim()) return;
    setError(null);
    const { error: err } = await supabase.from("reports").insert({
      reporter_id: userId,
      kind,
      ref_id: refId.trim(),
      ref_title: refId.trim(),
      reason,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setRefId("");
    onFiled();
  }

  return (
    <Panel title="File a report" hint="Goes straight into the live queue">
      {error && <p className="mb-2 text-xs font-semibold text-live">{error}</p>}
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="post">Post</option>
            <option value="video">Video</option>
            <option value="comment">Comment</option>
            <option value="user">User</option>
            <option value="short">Short</option>
            <option value="story">Story</option>
            <option value="article">Article</option>
          </Select>
        </Field>
        <Field label="Reference ID">
          <input
            value={refId}
            onChange={(e) => setRefId(e.target.value)}
            placeholder="uuid / @user"
            className={inputCls}
          />
        </Field>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          <button
            disabled={!refId.trim()}
            onClick={() => void file()}
            className="w-full rounded-full bg-foreground py-2.5 text-xs font-bold text-background disabled:opacity-50"
          >
            File report
          </button>
        </div>
      </div>
    </Panel>
  );
}

function ModerationLocalSection({ ops, act }: SectionProps) {
  const [kind, setKind] = useState("post");
  const [refId, setRefId] = useState("");
  const [reason, setReason] = useState(REASONS[0]!);
  const pending = ops.reports.filter((r) => r.status === "pending");

  function resolve(id: string, resolution: string, extra?: (s: OpStore) => OpStore) {
    act(`Moderate report ${id}: ${resolution}`, id, (s) => {
      const base: OpStore = {
        ...s,
        reports: s.reports.map((r) =>
          r.id === id ? { ...r, status: "resolved" as const, resolution } : r,
        ),
      };
      return extra ? extra(base) : base;
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat2 label="Pending" value={`${pending.length}`} alert={pending.length > 0} />
        <Stat2
          label="In review"
          value={`${ops.reports.filter((r) => r.status === "review").length}`}
        />
        <Stat2
          label="Resolved"
          value={`${ops.reports.filter((r) => r.status === "resolved").length}`}
        />
      </div>

      <Panel title="Moderation queue" hint="Review → approve, remove, warn, restrict or suspend">
        {ops.reports.length === 0 ? (
          <Empty text="Queue is clear." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-3">Content</th>
                  <th className="pb-2 pr-3">Reason</th>
                  <th className="pb-2 pr-3">Reports</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ops.reports.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3">
                      <p className="font-semibold">{r.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {r.kind} · {r.refId}
                      </p>
                      {r.resolution && (
                        <p className="text-[11px] text-muted-foreground">→ {r.resolution}</p>
                      )}
                    </td>
                    <td className="py-2 pr-3">{r.reason}</td>
                    <td className="py-2 pr-3 font-bold">{r.count}</td>
                    <td className="py-2 pr-3">
                      <Badge
                        tone={
                          r.status === "pending" ? "red" : r.status === "review" ? "brand" : "gray"
                        }
                      >
                        {r.status}
                      </Badge>
                    </td>
                    <td className="py-2">
                      {r.status === "resolved" ? (
                        <span className="text-xs text-muted-foreground">done</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          <ModBtn
                            label="Approve"
                            onClick={() => resolve(r.id, "Approved — no violation")}
                          />
                          <ModBtn
                            label="Remove"
                            danger
                            onClick={() =>
                              resolve(r.id, "Removed", (s) => ({
                                ...s,
                                hidden: [
                                  ...s.hidden,
                                  { kind: r.kind, refId: r.refId, reason: r.reason },
                                ],
                              }))
                            }
                          />
                          <ModBtn label="Warn" onClick={() => resolve(r.id, "User warned")} />
                          <ModBtn
                            label="Restrict"
                            danger
                            onClick={() => resolve(r.id, "User restricted")}
                          />
                          <ModBtn
                            label="Suspend"
                            danger
                            onClick={() =>
                              resolve(r.id, "User suspended", (s) =>
                                r.kind === "user"
                                  ? {
                                      ...s,
                                      flags: {
                                        ...s.flags,
                                        [r.refId]: { ...s.flags[r.refId], suspended: true },
                                      },
                                    }
                                  : s,
                              )
                            }
                          />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="File a report" hint="Manual intake">
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="post">Post</option>
              <option value="video">Video</option>
              <option value="comment">Comment</option>
              <option value="user">User</option>
            </Select>
          </Field>
          <Field label="Reference ID">
            <input
              value={refId}
              onChange={(e) => setRefId(e.target.value)}
              placeholder="v-2 / @user"
              className={inputCls}
            />
          </Field>
          <Field label="Reason">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <button
              disabled={!refId.trim()}
              onClick={() => {
                act("File report", refId.trim(), (s) => ({
                  ...s,
                  reports: [
                    {
                      id: newId("r"),
                      kind: kind as "post",
                      refId: refId.trim(),
                      title: refId.trim(),
                      reason,
                      count: 1,
                      status: "pending",
                      createdAt: new Date().toISOString(),
                    },
                    ...s.reports,
                  ],
                }));
                setRefId("");
              }}
              className="w-full rounded-full bg-foreground py-2.5 text-xs font-bold text-background disabled:opacity-50"
            >
              File report
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Stat2({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className={cn("text-2xl font-bold", alert && "text-live")}>{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function ModBtn({
  label,
  danger,
  disabled,
  onClick,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-full px-3 py-1.5 text-[11px] font-bold disabled:opacity-40",
        danger ? "bg-live/10 text-live" : "bg-secondary text-foreground",
      )}
    >
      {label}
    </button>
  );
}

/* ---------------------------------------------------------- PAYMENTS */
export function PaymentsSection({ ops, act }: SectionProps) {
  const [filter, setFilter] = useState("all");
  const done = ops.txns.filter((t) => t.status === "completed");
  const volume = done.reduce((s, t) => s + t.amount, 0);
  const fees = done.reduce((s, t) => s + t.fee, 0);
  const providers = ["M-Pesa", "Airtel Money", "Mixx"] as const;
  const rows = ops.txns.filter((t) => filter === "all" || t.status === filter);

  function setStatus(
    id: string,
    status: "completed" | "pending" | "failed" | "refunded",
    verb: string,
  ) {
    act(`${verb} transaction`, id, (s) => ({
      ...s,
      txns: s.txns.map((t) => (t.id === id ? { ...t, status } : t)),
    }));
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Stat2 label="Volume" value={tz(volume)} />
        <Stat2 label="Platform fees" value={tz(fees)} />
        <Stat2
          label="Pending"
          value={`${ops.txns.filter((t) => t.status === "pending").length}`}
          alert
        />
        <Stat2
          label="Failed"
          value={`${ops.txns.filter((t) => t.status === "failed").length}`}
          alert={ops.txns.some((t) => t.status === "failed")}
        />
      </div>
      <Panel title="Providers">
        <div className="grid gap-2 sm:grid-cols-3">
          {providers.map((p) => {
            const total = done.filter((t) => t.provider === p).reduce((s, t) => s + t.amount, 0);
            const count = ops.txns.filter((t) => t.provider === p).length;
            return (
              <div key={p} className="rounded-2xl bg-secondary p-3">
                <p className="text-sm font-bold">{p}</p>
                <p className="mt-1 text-lg font-bold">{tz(total)}</p>
                <p className="text-[11px] text-muted-foreground">{count} transactions</p>
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel
        title="Transactions"
        right={
          <span className="flex items-center gap-2">
            <Select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter status"
              className="w-auto"
            >
              {["all", "completed", "pending", "failed", "refunded"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <button
              onClick={() =>
                exportCsv(
                  "transactions.csv",
                  ops.txns.map((t) => [
                    t.id,
                    t.user,
                    t.provider,
                    t.type,
                    t.amount,
                    t.fee,
                    t.status,
                    t.createdAt,
                  ]),
                  ["id", "user", "provider", "type", "amount", "fee", "status", "created_at"],
                )
              }
              className="rounded-full bg-secondary px-3 py-1.5 text-xs font-bold"
            >
              Export CSV
            </button>
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 pr-3">ID</th>
                <th className="pb-2 pr-3">User</th>
                <th className="pb-2 pr-3">Provider</th>
                <th className="pb-2 pr-3">Amount</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="py-2 pr-3 font-mono text-xs">{t.id}</td>
                  <td className="py-2 pr-3 font-semibold">@{t.user}</td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {t.provider} · {t.type}
                  </td>
                  <td className="py-2 pr-3 font-bold">{tz(t.amount)}</td>
                  <td className="py-2 pr-3">
                    <Badge
                      tone={
                        t.status === "completed"
                          ? "dark"
                          : t.status === "pending"
                            ? "brand"
                            : t.status === "failed"
                              ? "red"
                              : "gray"
                      }
                    >
                      {t.status}
                    </Badge>
                  </td>
                  <td className="py-2">
                    <span className="flex flex-wrap gap-1">
                      {t.status === "pending" && (
                        <>
                          <ModBtn
                            label="Approve"
                            onClick={() => setStatus(t.id, "completed", "Approve payout")}
                          />
                          <ModBtn
                            label="Refund"
                            danger
                            onClick={() => setStatus(t.id, "refunded", "Refund transaction")}
                          />
                        </>
                      )}
                      {t.status === "failed" && (
                        <ModBtn
                          label="Retry"
                          onClick={() => setStatus(t.id, "completed", "Retry transaction")}
                        />
                      )}
                      {t.status === "completed" && t.type === "withdrawal" && (
                        <ModBtn
                          label="Refund"
                          danger
                          onClick={() => setStatus(t.id, "refunded", "Refund transaction")}
                        />
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------- CREATORS */

/** Both the admin endpoint and the metrics RPC leaderboard share this shape. */
type CreatorRow = AdminCreator;

export function CreatorsSection({ m, ops, act }: SectionProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-creators"],
    staleTime: 30_000,
    queryFn: () => fetchAdminCreators(),
    retry: false,
  });
  const live = data?.live === true;
  // Endpoint first; the metrics RPC leaderboard is only a stand-in when the
  // service-role backend isn't configured.
  const leaders: CreatorRow[] =
    live && data.creators.length > 0 ? data.creators : ((m?.leaders ?? []) as CreatorRow[]);

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Creator management"
        hint={
          isLoading
            ? "Fetching creators…"
            : live
              ? "Live from the admin endpoint · true follower and post counts"
              : "Endpoint unavailable — showing metrics RPC leaderboard"
        }
        right={<Badge tone={live ? "dark" : "gray"}>{live ? "API live" : "fallback"}</Badge>}
      >
        {isLoading ? (
          <Empty text="Loading creators…" />
        ) : leaders.length === 0 ? (
          <Empty text="No creators yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-3">Creator</th>
                  <th className="pb-2 pr-3">Followers</th>
                  <th className="pb-2 pr-3">Posts</th>
                  <th className="pb-2 pr-3">Est. earnings</th>
                  <th className="pb-2">Payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leaders.map((l) => {
                  const payout = ops.payouts[l.id] ?? "unpaid";
                  return (
                    <tr key={l.id}>
                      <td className="py-2 pr-3">
                        <p className="flex items-center gap-1 font-semibold">
                          {l.display_name}
                          {l.verified && <Badge tone="brand">verified</Badge>}
                        </p>
                        <p className="text-[11px] text-muted-foreground">@{l.username}</p>
                      </td>
                      <td className="py-2 pr-3 font-bold">{l.followers.toLocaleString()}</td>
                      <td className="py-2 pr-3">{l.posts}</td>
                      <td className="py-2 pr-3 font-bold">{tz(l.followers * 2)}</td>
                      <td className="py-2 pr-3">
                        <Select
                          value={payout}
                          onChange={(e) =>
                            act(`Set payout ${e.target.value}`, `@${l.username}`, (s) => ({
                              ...s,
                              payouts: {
                                ...s.payouts,
                                [l.id]: e.target.value as "unpaid" | "pending" | "paid",
                              },
                            }))
                          }
                          aria-label={`Payout status for ${l.username}`}
                          className="w-auto"
                        >
                          <option value="unpaid">unpaid</option>
                          <option value="pending">pending</option>
                          <option value="paid">paid</option>
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
