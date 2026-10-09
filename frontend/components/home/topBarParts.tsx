import { Link } from "@tanstack/react-router";
import { Heart, MessageCircle, UserPlus, Users } from "lucide-react";
import { useConversations } from "@/frontend/hooks/useMessages";
import type { AppNotification } from "@/frontend/hooks/useNotifications";

export function InboxIcon({ kind }: { kind: string }) {
  const cls = "size-4 shrink-0";
  if (kind === "follow") return <UserPlus className={`${cls} text-brand`} />;
  if (kind === "like" || kind === "comment_like") return <Heart className={`${cls} text-live`} />;
  if (kind === "blend_invite") return <Users className={`${cls} text-brand`} />;
  return <MessageCircle className={`${cls} text-foreground`} />;
}

export function InboxRow({
  n,
  close,
  onRead,
  ago,
}: {
  n: import("@/frontend/hooks/useNotifications").AppNotification;
  close: () => void;
  onRead: () => void;
  ago: string;
}) {
  const body = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary">
        <InboxIcon kind={n.kind} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-snug text-foreground">
          <span className="font-bold">@{n.actor_username}</span> {n.text}
        </span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{ago}</span>
      </span>
      {!n.is_read && <span className="mt-1 size-2 shrink-0 rounded-full bg-brand" />}
    </>
  );
  const cls = "flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-secondary";
  if (n.kind === "follow") {
    return (
      <li>
        <Link
          to="/u/$username"
          params={{ username: n.actor_username }}
          onClick={() => {
            onRead();
            close();
          }}
          className={cls}
        >
          {body}
        </Link>
      </li>
    );
  }
  if (n.kind === "blend_invite") {
    return (
      <li>
        <Link
          to="/shorts"
          onClick={() => {
            onRead();
            close();
          }}
          className={cls}
        >
          {body}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <button onClick={onRead} className={cls}>
        {body}
      </button>
    </li>
  );
}

export function MessagePreviewList({
  userId,
  onOpen,
  onClose,
}: {
  userId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const { data: convos = [], isLoading } = useConversations(userId);
  const unread = convos.reduce((s, c) => s + c.unread, 0);
  if (isLoading) {
    return (
      <div className="space-y-2 py-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-2xl bg-secondary" />
        ))}
      </div>
    );
  }
  if (convos.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No conversations yet. Visit someone&apos;s profile and tap Message.
      </p>
    );
  }
  return (
    <>
      {unread > 0 && (
        <p className="px-1 pb-1 text-xs font-semibold text-muted-foreground">{unread} unread</p>
      )}
      <ul className="max-h-[60dvh] divide-y divide-border overflow-y-auto">
        {convos.slice(0, 8).map((c) => (
          <li key={c.id}>
            <button
              onClick={() => onOpen(c.id)}
              className="flex w-full items-center gap-3 py-2.5 text-left"
            >
              {c.peer.avatar_url ? (
                <img
                  src={c.peer.avatar_url}
                  alt={c.peer.display_name}
                  className="size-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
                  {c.peer.display_name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{c.peer.display_name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {c.lastMessage}
                </span>
              </span>
              {c.unread > 0 && (
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand text-[10px] font-bold text-brand-foreground">
                  {c.unread > 9 ? "9+" : c.unread}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <Link
        to="/messages"
        search={{}}
        onClick={onClose}
        className="mt-2 block rounded-full bg-secondary py-2.5 text-center text-sm font-semibold"
      >
        Open all messages
      </Link>
    </>
  );
}

export function MessageBadge({ userId }: { userId: string | null }) {
  const { data: convos = [] } = useConversations(userId);
  const unread = convos.reduce((s, c) => s + c.unread, 0);
  if (unread === 0) return null;
  return (
    <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-brand text-[9px] font-bold text-brand-foreground">
      {unread > 9 ? "9+" : unread}
    </span>
  );
}
