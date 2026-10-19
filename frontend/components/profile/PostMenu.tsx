import { useState } from "react";
import { publicUrl } from "@/frontend/lib/native";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Archive,
  ArchiveRestore,
  Bookmark,
  Download,
  Edit3,
  EyeOff,
  Flag,
  Link2,
  MoreHorizontal,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ShareSheet } from "@/frontend/components/overlays/ShareSheet";
import { ReportDialog } from "@/frontend/components/moderation/ReportDialog";
import type { ProfilePost } from "@/frontend/hooks/useMyProfileData";
import { useToggleSave } from "@/frontend/hooks/useSavedPosts";
import { deleteOwnedPost, setOwnedPostStatus } from "@/backend/api/posts.functions";
import { invalidateHomeCache } from "@/backend/api/home.functions";
import { removeStoredObjects } from "@/frontend/lib/storageUpload";

const HIDDEN_KEY = "wizz:hidden-posts";

export function hiddenPostIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function hidePostLocally(id: string) {
  try {
    const next = new Set([...hiddenPostIds(), id]);
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
  } catch {
    // storage unavailable
  }
}

/**
 * Contextual three-dot menu for any post/video surface. Owners get manage
 * actions (edit/archive/delete); everyone else gets viewer actions
 * (save/share/copy/not-interested/report). Mutations are owner-enforced by
 * RLS and by the deleteOwnedPost/setOwnedPostStatus server functions, so a
 * forged request against another user's post is rejected server-side.
 */
export function PostMenu({
  post,
  isOwner,
  userId,
  username,
  onEdit,
  onHidden,
  onDeleted,
  size = "md",
}: {
  post: ProfilePost;
  isOwner: boolean;
  userId: string | null;
  username?: string;
  onEdit?: () => void;
  onHidden?: (id: string) => void;
  onDeleted?: (id: string) => void;
  size?: "sm" | "md";
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "archive" | "delete">(null);
  const [sharing, setSharing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const toggleSave = useToggleSave(userId);
  const updateOwnedStatus = useServerFn(setOwnedPostStatus);
  const deleteOwned = useServerFn(deleteOwnedPost);
  const bustCache = useServerFn(invalidateHomeCache);

  const postUrl =
    typeof window !== "undefined" && username
      ? publicUrl(`/u/${username}#post-${post.id}`)
      : `post-${post.id}`;
  const mediaSrc = post.video_url || post.image_url;

  async function refresh() {
    try {
      await bustCache();
    } catch {
      // TTLs remain the fallback.
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["home"] }),
      queryClient.invalidateQueries({ queryKey: ["my-posts"] }),
      queryClient.invalidateQueries({ queryKey: ["profile-posts"] }),
    ]);
  }

  function copyLink() {
    try {
      void navigator.clipboard.writeText(postUrl);
      toast("Link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  }

  async function setStatus(status: "archived" | "deleted" | "published") {
    setBusy(true);
    try {
      await updateOwnedStatus({ data: { postId: post.id, status } });
      await refresh();
      setOpen(false);
      setConfirm(null);
      if (status === "deleted") onDeleted?.(post.id);
      toast(
        status === "archived"
          ? "Moved to archive"
          : status === "deleted"
            ? "Post deleted"
            : "Post restored",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function wipe() {
    setBusy(true);
    try {
      await deleteOwned({ data: { postId: post.id } });
      await removeStoredObjects("post-images", [
        post.thumbnail_url,
        post.thumbnail_path,
        post.image_url,
        post.image_path,
        post.video_url,
        post.video_path,
      ]).catch(() => undefined);
      await refresh();
      setOpen(false);
      setConfirm(null);
      onDeleted?.(post.id);
      toast("Post deleted permanently");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const btn =
    size === "sm"
      ? "grid size-7 place-items-center rounded-full bg-black/55 text-white"
      : "grid size-8 place-items-center rounded-full bg-secondary text-foreground";

  return (
    <>
      <span className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
        <button
          aria-label="Post options"
          onClick={() => {
            setOpen((v) => !v);
            setConfirm(null);
          }}
          className={btn}
        >
          <MoreHorizontal className={size === "sm" ? "size-3.5" : "size-4"} />
        </button>
        {open && (
          <>
            <button
              aria-label="Close menu"
              onClick={() => {
                setOpen(false);
                setConfirm(null);
              }}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div className="absolute right-0 top-8 z-20 w-60 overflow-hidden rounded-2xl border border-border bg-card shadow-raise">
              {confirm === null && (
                <>
                  {isOwner && onEdit && (
                    <MenuItem
                      Icon={Edit3}
                      label="Edit"
                      onClick={() => {
                        setOpen(false);
                        onEdit();
                      }}
                    />
                  )}
                  {mediaSrc && (
                    <a
                      href={mediaSrc}
                      download
                      onClick={() => setOpen(false)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium hover:bg-secondary"
                    >
                      <Download className="size-4 text-muted-foreground" /> Save to device
                    </a>
                  )}
                  {!isOwner && (
                    <MenuItem
                      Icon={Bookmark}
                      label="Save"
                      onClick={() => {
                        setOpen(false);
                        if (!userId) {
                          toast.error("Sign in to save posts.");
                          return;
                        }
                        toggleSave.mutate(
                          { postId: post.id, save: true },
                          { onSuccess: () => toast("Saved to your collection") },
                        );
                      }}
                    />
                  )}
                  <MenuItem
                    Icon={Share2}
                    label="Share"
                    onClick={() => {
                      setOpen(false);
                      setSharing(true);
                    }}
                  />
                  <MenuItem
                    Icon={Link2}
                    label="Copy link"
                    onClick={() => {
                      setOpen(false);
                      copyLink();
                    }}
                  />
                  {!isOwner && (
                    <>
                      <MenuItem
                        Icon={EyeOff}
                        label="Not interested"
                        onClick={() => {
                          setOpen(false);
                          hidePostLocally(post.id);
                          onHidden?.(post.id);
                          toast("We'll show you less like this");
                        }}
                      />
                      <MenuItem
                        Icon={Flag}
                        label="Report"
                        onClick={() => {
                          setOpen(false);
                          setReporting(true);
                        }}
                      />
                    </>
                  )}
                  {isOwner && post.status === "archived" && (
                    <MenuItem
                      Icon={ArchiveRestore}
                      label="Restore"
                      onClick={() => void setStatus("published")}
                    />
                  )}
                  {isOwner && post.status !== "archived" && (
                    <MenuItem
                      Icon={Archive}
                      label="Archive"
                      onClick={() => setConfirm("archive")}
                    />
                  )}
                  {isOwner && (
                    <MenuItem
                      Icon={Trash2}
                      label="Delete"
                      danger
                      onClick={() => setConfirm("delete")}
                    />
                  )}
                </>
              )}
              {confirm === "archive" && (
                <div className="p-3">
                  <p className="text-sm font-bold">Archive this post?</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    It leaves your profile but stays recoverable.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setConfirm(null)}
                      className="flex-1 rounded-full bg-secondary py-2 text-sm font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void setStatus("archived")}
                      className="flex-1 rounded-full bg-brand py-2 text-sm font-bold text-brand-foreground disabled:opacity-60"
                    >
                      Archive
                    </button>
                  </div>
                </div>
              )}
              {confirm === "delete" && (
                <div className="p-3">
                  <p className="text-sm font-bold">Delete this post?</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Soft-deletes first; a second delete removes it for good.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setConfirm(null)}
                      className="flex-1 rounded-full bg-secondary py-2 text-sm font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void (post.status === "deleted" ? wipe() : setStatus("deleted"))
                      }
                      className="flex-1 rounded-full bg-live py-2 text-sm font-bold text-white disabled:opacity-60"
                    >
                      {post.status === "deleted" ? "Delete forever" : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </span>
      {sharing && (
        <ShareSheet
          open
          onClose={() => setSharing(false)}
          url={postUrl}
          message={post.caption.slice(0, 80) || "Check this out on WIZZ"}
        />
      )}
      {reporting && (
        <ReportDialog
          open
          onClose={() => setReporting(false)}
          target={{ kind: "post", refId: post.id, refTitle: post.caption.slice(0, 80) }}
        />
      )}
    </>
  );
}

function MenuItem({
  Icon,
  label,
  onClick,
  danger,
}: {
  Icon: typeof Flag;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium hover:bg-secondary ${danger ? "font-semibold text-live" : ""}`}
    >
      <Icon className={`size-4 ${danger ? "" : "text-muted-foreground"}`} /> {label}
    </button>
  );
}
