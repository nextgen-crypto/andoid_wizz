import { useEffect, useRef, useState } from "react";
import { Link, getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Loader2,
  MessageCircle,
  SendHorizonal,
  Smile,
} from "lucide-react";
import { AppShell } from "@/frontend/components/AppShell";
import { useSession } from "@/frontend/hooks/useSession";
import { useConversations, useMessages } from "@/frontend/hooks/useMessages";
import { setActiveConv } from "@/frontend/hooks/useMessageNotifications";
import { cn } from "@/lib/utils";
import { timeAgoCompact } from "@/frontend/lib/format";

const routeApi = getRouteApi("/messages");

function useChatHeight(): number {
  const [height, setHeight] = useState<number>(
    () => window.visualViewport?.height ?? window.innerHeight,
  );
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setHeight(vv.height);
    vv.addEventListener("resize", update);
    update();
    return () => vv.removeEventListener("resize", update);
  }, []);
  return height;
}

function formatDateSeparator(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isRecentlyActive(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 5 * 60 * 1000;
}

function PeerAvatar({
  src,
  name,
  size = "md",
}: {
  src: string | null | undefined;
  name: string;
  size?: "sm" | "md";
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name ?? "").trim().slice(0, 1).toUpperCase() || "?";
  const cls = size === "sm" ? "size-7 text-[10px]" : "size-11 text-sm";
  if (!src || failed) {
    return (
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-2xl bg-brand font-bold text-brand-foreground",
          cls,
        )}
      >
        {initial}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-2xl object-cover", cls)}
    />
  );
}

function ReadReceipt({
  isMine,
  isRead,
  time,
}: {
  isMine: boolean;
  isRead: boolean;
  time: string;
}) {
  if (!isMine) return null;
  return (
    <span className="mt-0.5 flex items-center justify-end gap-0.5 text-[10px] text-white/60">
      {formatTime(time)}
      {isRead ? (
        <CheckCheck className="size-3 text-white/80" />
      ) : (
        <Check className="size-3 text-white/50" />
      )}
    </span>
  );
}

type ActiveMessages = ReturnType<typeof useMessages>["messages"];

function isLastInRun(msgs: ActiveMessages, idx: number): boolean {
  const next = msgs[idx + 1];
  return !next || next.mine !== msgs[idx]?.mine;
}

export function MessagesScreen() {
  const { session, loading, user } = useSession();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const { c } = routeApi.useSearch();
  const { data: convos = [], isLoading } = useConversations(userId);
  const [selected, setSelected] = useState<string | null>(c ?? null);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatHeight = useChatHeight();

  useEffect(() => {
    if (c) setSelected(c);
  }, [c]);

  useEffect(() => {
    if (!selected && convos.length > 0 && window.innerWidth >= 1024) {
      setSelected(convos[0]!.id);
    }
  }, [convos, selected]);

  const active = convos.find((x) => x.id === selected) ?? null;
  const thread = useMessages(selected, userId);
  const activeMessages = selected ? thread.messages : [];

  useEffect(() => {
    if (selected) {
      thread.markRead();
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, activeMessages.length]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport || !selected) return;
    let frame = 0;
    const keepBottomVisible = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ block: "end" });
      });
    };
    viewport.addEventListener("resize", keepBottomVisible);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", keepBottomVisible);
    };
  }, [selected]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [draft]);

  function pick(id: string) {
    setSelected(id);
    setDraft("");
    setActiveConv(id);
    void navigate({ to: "/messages", search: { c: id }, replace: true });
  }

  function send() {
    const text = draft.trim();
    if (!text || !selected) return;
    thread.send(text, { onSuccess: () => setDraft("") });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Build date-separated message list
  function renderMessages(msgs: ActiveMessages) {
    const items: React.ReactNode[] = [];
    let lastDate = "";

    msgs.forEach((m, idx) => {
      const msgDate = formatDateSeparator(m.created_at);
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        items.push(
          <div key={`sep-${m.id}`} className="my-3 flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="rounded-full bg-secondary px-3 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {msgDate}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>,
        );
      }

      const lastInRun = isLastInRun(msgs, idx);
      const showAvatar = !m.mine && lastInRun;

      items.push(
        <div
          key={m.id}
          className={cn(
            "flex items-end gap-2",
            m.mine ? "justify-end" : "justify-start",
            !lastInRun && "mb-0.5",
          )}
        >
          {!m.mine && (
            <div className="w-7 shrink-0">
              {showAvatar && active && (
                <PeerAvatar src={active.peer.avatar_url} name={active.peer.display_name} size="sm" />
              )}
            </div>
          )}
          <div className={cn("flex max-w-[78%] flex-col", m.mine ? "items-end" : "items-start")}>
            <p
              className={cn(
                "break-words rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed",
                m.mine
                  ? "rounded-br-sm bg-brand text-brand-foreground"
                  : "rounded-bl-sm bg-secondary text-foreground",
              )}
            >
              {m.body}
            </p>
            {m.mine ? (
              <ReadReceipt isMine={true} isRead={m.is_read} time={m.created_at} />
            ) : (
              lastInRun && (
                <span className="mt-0.5 text-[10px] text-muted-foreground">
                  {formatTime(m.created_at)}
                </span>
              )
            )}
          </div>
        </div>,
      );
    });

    return items;
  }

  if (loading) {
    return (
      <AppShell title="Messages" hideNav>
        <div className="space-y-2 px-4 pt-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-secondary" />
          ))}
        </div>
      </AppShell>
    );
  }

  if (!session) {
    return (
      <AppShell title="Messages" hideNav>
        <div className="flex flex-col items-center px-6 pt-16 text-center">
          <span className="grid size-16 place-items-center rounded-2xl bg-secondary">
            <MessageCircle className="size-8 text-muted-foreground" />
          </span>
          <h2 className="mt-4 text-xl font-bold">Sign in to message</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your conversations live here once you log in.
          </p>
          <Link
            to="/auth"
            className="mt-5 w-full rounded-full bg-brand px-5 py-3 text-sm font-bold text-brand-foreground"
          >
            Log in
          </Link>
        </div>
      </AppShell>
    );
  }

  const list = (
    <div className="min-w-0">
      <h2 className="px-4 pb-2 pt-4 text-xl font-bold">Messages</h2>
      {isLoading ? (
        <div className="space-y-2 px-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-secondary" />
          ))}
        </div>
      ) : convos.length === 0 ? (
        <div className="flex flex-col items-center px-6 pt-16 text-center">
          <span className="grid size-16 place-items-center rounded-2xl bg-secondary">
            <MessageCircle className="size-8 text-muted-foreground" />
          </span>
          <p className="mt-4 text-sm font-semibold text-foreground">No messages yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Visit someone&apos;s profile and tap Message to start chatting.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {convos.map((conv) => {
            const online = isRecentlyActive(conv.lastAt);
            return (
              <li key={conv.id}>
                <button
                  onClick={() => pick(conv.id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                    selected === conv.id ? "bg-brand/8" : "hover:bg-secondary",
                  )}
                >
                  <div className="relative shrink-0">
                    <PeerAvatar src={conv.peer.avatar_url} name={conv.peer.display_name} />
                    {online && (
                      <span className="absolute bottom-0.5 right-0.5 size-2.5 rounded-full border-2 border-background bg-green-500" />
                    )}
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-bold">{conv.peer.display_name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {timeAgoCompact(conv.lastAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] text-muted-foreground">
                        {conv.lastMessage}
                      </span>
                      {conv.unread > 0 && (
                        <span
                          className={cn(
                            "grid shrink-0 place-items-center rounded-full bg-brand text-[10px] font-bold text-brand-foreground",
                            conv.unread > 1 ? "min-w-[20px] px-1.5 py-0.5" : "size-5",
                          )}
                        >
                          {conv.unread > 9 ? "9+" : conv.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const composer = (
    <div className="flex items-end gap-2.5">
      <button
        aria-label="Emoji"
        type="button"
        className="mb-2 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
      >
        <Smile className="size-5" />
      </button>
      <textarea
        ref={textareaRef}
        value={draft}
        rows={1}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message…"
        maxLength={1000}
        aria-label="Write a message"
        className="min-h-[44px] min-w-0 flex-1 resize-none overflow-hidden rounded-2xl bg-secondary px-4 py-2.5 text-base leading-relaxed outline-none placeholder:text-muted-foreground"
        style={{ height: "auto" }}
      />
      <button
        aria-label="Send message"
        type="button"
        onClick={send}
        disabled={!draft.trim() || thread.sending}
        className={cn(
          "mb-1 grid size-11 shrink-0 place-items-center rounded-full bg-brand text-brand-foreground transition-all disabled:opacity-50",
          draft.trim() && "animate-pulse",
        )}
      >
        {thread.sending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <SendHorizonal className="size-5" />
        )}
      </button>
    </div>
  );

  if (active && selected) {
    const online = isRecentlyActive(active.lastAt);
    return (
      <>
        <div
          className="fixed inset-x-0 top-0 flex flex-col bg-background lg:hidden"
          style={{ height: chatHeight, zIndex: 9999 }}
        >
          {/* Header */}
          <div className="flex flex-none items-center gap-3 border-b border-border px-4 py-3 pt-safe">
            <button
              aria-label="Back to conversations"
              type="button"
              onClick={() => {
                setSelected(null);
                void navigate({ to: "/messages", search: {}, replace: true });
              }}
              className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-secondary"
            >
              <ArrowLeft className="size-5" />
            </button>
            <Link
              to="/u/$username"
              params={{ username: active.peer.username }}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              <div className="relative shrink-0">
                <PeerAvatar src={active.peer.avatar_url} name={active.peer.display_name} />
                {online && (
                  <span className="absolute bottom-0.5 right-0.5 size-2.5 rounded-full border-2 border-background bg-green-500" />
                )}
              </div>
              <span className="min-w-0">
                <span className="block truncate text-base font-bold">
                  {active.peer.display_name}
                </span>
                <span className={cn("block truncate text-xs", online ? "text-green-500 font-semibold" : "text-muted-foreground")}>
                  {online ? "Active now" : `@${active.peer.username}`}
                </span>
              </span>
            </Link>
          </div>

          {/* Message list */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
            <div className="flex-1" />
            {thread.isLoading ? (
              <Loader2 className="mx-auto mb-4 size-6 animate-spin text-muted-foreground" />
            ) : activeMessages.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <span className="grid size-14 place-items-center rounded-2xl bg-secondary">
                  <MessageCircle className="size-6 text-muted-foreground" />
                </span>
                <p className="mt-3 text-sm text-muted-foreground">
                  No messages yet — say hi 👋
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {renderMessages(activeMessages)}
              </div>
            )}
            {thread.sending && (
              <div className="mt-2 flex items-center gap-2 px-2">
                <div className="flex gap-1">
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
                </div>
                <span className="text-xs text-muted-foreground">Sending…</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div className="flex-none border-t border-border px-4 py-3 pb-safe">
            {composer}
            {thread.sendError && (
              <p className="mt-1.5 text-xs font-semibold text-live">
                Couldn&apos;t send. Try again.
              </p>
            )}
          </div>
        </div>

        {/* Desktop two-column layout */}
        <AppShell title="Messages" hideNav>
          <div className="hidden lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:divide-x lg:divide-border">
            <div>{list}</div>
            <div className="flex min-h-[60dvh] flex-col">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <Link
                  to="/u/$username"
                  params={{ username: active.peer.username }}
                  className="flex min-w-0 flex-1 items-center gap-2.5"
                >
                  <div className="relative shrink-0">
                    <img
                      src={active.peer.avatar_url ?? ""}
                      alt={active.peer.display_name}
                      className="size-9 rounded-xl object-cover"
                    />
                    {online && (
                      <span className="absolute bottom-0 right-0 size-2 rounded-full border-2 border-background bg-green-500" />
                    )}
                  </div>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">
                      {active.peer.display_name}
                    </span>
                    <span className={cn("block truncate text-xs", online ? "text-green-500 font-semibold" : "text-muted-foreground")}>
                      {online ? "Active now" : `@${active.peer.username}`}
                    </span>
                  </span>
                </Link>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
                <div className="flex-1" />
                {thread.isLoading ? (
                  <Loader2 className="mx-auto mb-4 size-5 animate-spin text-muted-foreground" />
                ) : activeMessages.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No messages yet — say hi.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {renderMessages(activeMessages)}
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
              <div className="shrink-0 border-t border-border px-3 py-3">
                {composer}
                {thread.sendError && (
                  <p className="mt-1.5 text-xs font-semibold text-live">
                    Couldn&apos;t send. Try again.
                  </p>
                )}
              </div>
            </div>
          </div>
        </AppShell>
      </>
    );
  }

  return (
    <AppShell title="Messages" hideNav>
      <div className="lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:divide-x lg:divide-border">
        <div className={cn(selected && "hidden lg:block")}>{list}</div>
        <div className={cn(!selected && "hidden lg:flex", "min-h-[60dvh] flex-col")}>
          <div className="hidden flex-1 place-items-center px-6 text-center lg:grid">
            <div className="flex flex-col items-center gap-3">
              <span className="grid size-16 place-items-center rounded-2xl bg-secondary">
                <MessageCircle className="size-8 text-muted-foreground" />
              </span>
              <p className="text-sm text-muted-foreground">
                Pick a conversation to start chatting.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
