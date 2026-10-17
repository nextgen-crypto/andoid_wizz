import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CornerDownRight, Flag, Heart, Loader2, SendHorizonal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet } from "@/frontend/components/overlays/Sheet";
import { ReportDialog, type ReportTarget } from "@/frontend/components/moderation/ReportDialog";
import { useSession } from "@/frontend/hooks/useSession";
import {
  useCommentReplies,
  usePostComments,
  type RemoteComment,
} from "@/frontend/hooks/usePostComments";
import { useDemoComments, type DemoComment } from "@/frontend/hooks/useDemoComments";
import { useComments } from "./CommentsContext";
import { writeErrorMessage } from "@/frontend/lib/writeError";
import { cn } from "@/lib/utils";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Render @mentions and #hashtags with subtle emphasis. */
function withTags(text: string): ReactNode {
  const parts = text.split(/(@[\p{L}\p{N}._]+|#[\p{L}\p{N}_]+)/gu);
  return parts.map((part, i) =>
    /^[@#]/u.test(part) ? (
      <span key={i} className="font-semibold text-brand">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

interface ViewModel {
  id: string;
  user: string;
  text: string;
  time: string;
  likes: number;
  isLiked: boolean;
  isMine: boolean;
  replyCount: number;
  authorId: string;
}

function fromRemote(c: RemoteComment): ViewModel {
  return {
    id: c.id,
    user: c.user,
    text: c.text,
    time: c.time,
    likes: c.likes,
    isLiked: c.isLiked,
    isMine: c.isMine,
    replyCount: c.replyCount,
    authorId: c.authorId,
  };
}

function fromDemo(c: DemoComment): ViewModel {
  return {
    id: c.id,
    user: c.user,
    text: c.text,
    time: c.time,
    likes: c.likes + (c.isLiked ? 1 : 0),
    isLiked: c.isLiked ?? false,
    isMine: c.isMine ?? false,
    replyCount: 0,
    authorId: c.user,
  };
}

/**
 * THE comments sheet. Mounted once at the app root (see CommentsContext).
 * Real posts read `usePostComments` (Supabase + realtime); demo/seed posts
 * fall back to `useDemoComments` (localStorage) so missing backend tables
 * never produce a blank sheet.
 */
export function CommentsSheet() {
  const { openPostId, closeComments } = useComments();
  const { user, displayName } = useSession();
  const userId = user?.id ?? null;

  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [sort, setSort] = useState<"newest" | "top">("newest");

  const isReal = openPostId !== null && isUuid(openPostId);
  const live = usePostComments(openPostId && isReal ? openPostId : null, userId);
  const demo = useDemoComments(openPostId && !isReal ? openPostId : null, displayName || "you");

  // Reset transient UI when the sheet switches post or closes.
  useEffect(() => {
    setDraft("");
    setReplyTo(null);
    setExpanded(new Set());
  }, [openPostId]);

  // Surface posting errors as a rollback toast.
  useEffect(() => {
    if (live.postError) toast.error(writeErrorMessage(live.postError, "Could not post comment."));
  }, [live.postError]);

  if (openPostId === null) return null;

  const rawComments: ViewModel[] = isReal
    ? (live.data?.comments ?? []).map(fromRemote)
    : demo.comments.map(fromDemo);
  const total = isReal ? (live.data?.total ?? 0) : demo.total;
  const isLoading = isReal ? live.isLoading : false;
  const hasError = isReal && !!live.error;

  const sorted = sort === "top" ? [...rawComments].sort((a, b) => b.likes - a.likes) : rawComments;

  function post() {
    const text = draft.trim();
    if (!text) return;
    if (isReal) live.postComment({ text, parentId: replyTo });
    else demo.postComment(text, null);
    setDraft("");
    setReplyTo(null);
  }

  return (
    <>
      <Sheet open onClose={closeComments} title={`Comments (${total})`}>
        {/* Sort toggle */}
        {sorted.length > 0 && (
          <div className="mb-2 flex items-center gap-3 px-1 text-xs font-semibold text-muted-foreground">
            <button
              onClick={() => setSort("newest")}
              className={cn(sort === "newest" && "text-foreground")}
            >
              Newest
            </button>
            <button
              onClick={() => setSort("top")}
              className={cn(sort === "top" && "text-foreground")}
            >
              Top
            </button>
          </div>
        )}

        {isLoading && <CommentSkeletons />}

        {hasError && (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">Couldn't load comments.</p>
            <button
              onClick={() => void live.refetch()}
              className="mt-3 rounded-full bg-secondary px-4 py-1.5 text-xs font-bold text-foreground"
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !hasError && (
          <ul className="space-y-4 px-1 py-1">
            {sorted.map((c) => (
              <CommentRow
                key={c.id}
                comment={c}
                isReal={isReal}
                userId={userId}
                expanded={expanded.has(c.id)}
                onToggleExpand={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  })
                }
                onLike={() =>
                  isReal
                    ? live.toggleLike({ commentId: c.id, like: !c.isLiked })
                    : demo.toggleLike(c.id)
                }
                onReply={() => setReplyTo(replyTo === c.id ? null : c.id)}
                onDelete={() => {
                  if (isReal) {
                    live.deleteComment(c.id);
                    toast("Comment deleted.");
                  } else {
                    demo.deleteComment(c.id);
                  }
                }}
                onReport={() =>
                  setReportTarget({
                    kind: "comment",
                    refId: c.id,
                    refTitle: c.text,
                    targetUserId: c.authorId,
                  })
                }
              />
            ))}
            {sorted.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Be the first to comment.
              </p>
            )}
          </ul>
        )}

        {/* Sticky composer */}
        <div className="sticky bottom-0 -mx-1 mt-2 border-t border-border bg-background px-1 pt-3 pb-safe">
          {userId ? (
            <div className="flex items-center gap-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
                {(displayName || "Y").slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                {replyTo && (
                  <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                    <CornerDownRight className="size-3" /> Replying…{" "}
                    <button onClick={() => setReplyTo(null)} className="underline">
                      cancel
                    </button>
                  </p>
                )}
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") post();
                  }}
                  placeholder="Add a comment…"
                  maxLength={280}
                  aria-label="Add a comment"
                  className="min-w-0 w-full rounded-full bg-secondary px-4 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
              <button
                aria-label="Post comment"
                onClick={post}
                disabled={!draft.trim() || (isReal && live.posting)}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-brand-foreground disabled:opacity-40"
              >
                {isReal && live.posting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <SendHorizonal className="size-4" />
                )}
              </button>
            </div>
          ) : (
            <Link
              to="/auth"
              className="block rounded-full bg-brand py-2.5 text-center text-sm font-bold text-brand-foreground"
            >
              Sign in to comment
            </Link>
          )}
        </div>
      </Sheet>

      {reportTarget && (
        <ReportDialog open onClose={() => setReportTarget(null)} target={reportTarget} />
      )}
    </>
  );
}

function CommentRow({
  comment,
  isReal,
  userId,
  expanded,
  onToggleExpand,
  onLike,
  onReply,
  onDelete,
  onReport,
}: {
  comment: ViewModel;
  isReal: boolean;
  userId: string | null;
  expanded: boolean;
  onToggleExpand: () => void;
  onLike: () => void;
  onReply: () => void;
  onDelete: () => void;
  onReport: () => void;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-foreground">
        {comment.user.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-muted-foreground">
          {comment.user} <span className="font-medium">· {comment.time}</span>
        </p>
        <p className="mt-0.5 break-words text-sm leading-snug text-foreground">
          {withTags(comment.text)}
        </p>
        <div className="mt-1 flex items-center gap-3 text-[11px] font-semibold text-muted-foreground">
          <button onClick={onReply} className="flex items-center gap-1">
            <CornerDownRight className="size-3" /> Reply
          </button>
          {comment.replyCount > 0 && (
            <button onClick={onToggleExpand} className="flex items-center gap-1">
              {expanded ? "Hide" : "View"} {comment.replyCount}{" "}
              {comment.replyCount === 1 ? "reply" : "replies"}
            </button>
          )}
        </div>
        {expanded && isReal && <Replies commentId={comment.id} userId={userId} onLike={() => {}} />}
      </div>
      <div className="flex shrink-0 flex-col items-center gap-0.5">
        <button aria-label="Like comment" onClick={onLike}>
          <Heart
            className={cn(
              "size-4",
              comment.isLiked ? "fill-live text-live" : "text-muted-foreground",
            )}
          />
        </button>
        <span className="text-[10px] font-semibold text-muted-foreground">{comment.likes}</span>
        {comment.isMine ? (
          <button aria-label="Delete comment" onClick={onDelete} className="mt-1">
            <Trash2 className="size-3.5 text-muted-foreground" />
          </button>
        ) : (
          <button aria-label="Report comment" onClick={onReport} className="mt-1">
            <Flag className="size-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
    </li>
  );
}

function Replies({
  commentId,
  userId,
}: {
  commentId: string;
  userId: string | null;
  onLike: () => void;
}) {
  const replies = useCommentReplies(commentId, userId, true);
  if (replies.isLoading) return <p className="mt-2 text-xs text-muted-foreground">Loading…</p>;
  return (
    <ul className="mt-2 space-y-3 border-l border-border pl-3">
      {(replies.data ?? []).map((r) => (
        <li key={r.id} className="flex items-start gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-foreground">
            {r.user.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-muted-foreground">
              {r.user} <span className="font-medium">· {r.time}</span>
            </p>
            <p className="mt-0.5 break-words text-xs leading-snug text-foreground">
              {withTags(r.text)}
            </p>
          </div>
          <Heart
            className={cn(
              "size-3.5 shrink-0",
              r.isLiked ? "fill-live text-live" : "text-muted-foreground",
            )}
          />
        </li>
      ))}
    </ul>
  );
}

function CommentSkeletons() {
  return (
    <ul className="space-y-4 px-1 py-1">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-start gap-2.5 animate-pulse">
          <span className="size-8 shrink-0 rounded-full bg-secondary" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-24 rounded bg-secondary" />
            <div className="h-3 w-full rounded bg-secondary" />
          </div>
        </li>
      ))}
    </ul>
  );
}
