import { useEffect, useRef, useState } from "react";
import { Link, getRouteApi, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, SendHorizonal } from "lucide-react";
import { AppShell } from "@/frontend/components/AppShell";
import { useSession } from "@/frontend/hooks/useSession";
import { useConversations, useMessages } from "@/frontend/hooks/useMessages";
import { useMessageNotifications } from "@/frontend/hooks/useMessageNotifications";
import { cn } from "@/lib/utils";
import { timeAgoCompact } from "@/frontend/lib/format";

const routeApi = getRouteApi("/messages");

/**
 * Returns the current visual viewport height in pixels.
 * On Android WebView with adjustResize, this shrinks when the soft keyboard
 * opens — giving us the exact space available above the keyboard.
 * Using this instead of `fixed inset-0` avoids the well-known Android bug
 * where fixed elements don't respond to keyboard-driven viewport changes.
 */
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

export function MessagesScreen() {
  const { session, loading, user } = useSession();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const { c } = routeApi.useSearch();
  const { data: convos = [], isLoading } = useConversations(userId);
  const [selected, setSelected] = useState<string | null>(c ?? null);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const chatHeight = useChatHeight();
  const { setActiveConv } = useMessageNotifications(userId);

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

  // Keep the newest message and the composer in view when the on-screen
  // keyboard opens. Android resizes the WebView; browsers report the new
  // height through visualViewport.
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
          <h2 className="text-xl font-bold">Sign in to message</h2>
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
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          No conversations yet. Visit someone&apos;s profile and tap Message.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {convos.map((conv) => (
            <li key={conv.id}>
              <button
                onClick={() => pick(conv.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary",
                  selected === conv.id && "bg-secondary",
                )}
              >
                {conv.peer.avatar_url ? (
                  <img
                    src={conv.peer.avatar_url}
                    alt={conv.peer.display_name}
                    className="size-11 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-brand-foreground">
                    {conv.peer.display_name.slice(0, 1).toUpperCase()}
                  </span>
                )}
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
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand text-[10px] font-bold text-brand-foreground">
                        {conv.unread > 9 ? "9+" : conv.unread}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  if (active && selected) {
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
              {active.peer.avatar_url ? (
                <img
                  src={active.peer.avatar_url}
                  alt={active.peer.display_name}
                  className="size-11 rounded-full object-cover"
                />
              ) : (
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-brand-foreground">
                  {active.peer.display_name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-base font-bold">
                  {active.peer.display_name}
                </span>
                <span className="block truncate text-sm text-muted-foreground">
                  @{active.peer.username}
                </span>
              </span>
            </Link>
          </div>

          {/* Message list — flex spacer pushes messages to bottom (WhatsApp-style) */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
            <div className="flex-1" />
            {thread.isLoading ? (
              <Loader2 className="mx-auto mb-4 size-6 animate-spin text-muted-foreground" />
            ) : activeMessages.length === 0 ? (
              <p className="py-8 text-center text-base text-muted-foreground">
                No messages yet — say hi.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {activeMessages.map((m) => (
                  <div key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
                    <p
                      className={cn(
                        "max-w-[78%] break-words rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed",
                        m.mine ? "bg-brand text-brand-foreground" : "bg-secondary text-foreground",
                      )}
                    >
                      {m.body}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer — pinned to the bottom of the (keyboard-aware) container */}
          <div className="flex-none border-t border-border px-4 py-3 pb-safe">
            <div className="flex items-center gap-3">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
                placeholder="Message…"
                maxLength={1000}
                aria-label="Write a message"
                className="min-w-0 flex-1 rounded-full bg-secondary px-5 py-3 text-base outline-none placeholder:text-muted-foreground"
              />
              <button
                aria-label="Send message"
                onClick={send}
                disabled={!draft.trim() || thread.sending}
                className="grid size-12 shrink-0 place-items-center rounded-full bg-brand text-brand-foreground disabled:opacity-50"
              >
                <SendHorizonal className="size-5" />
              </button>
            </div>
            {thread.sendError && (
              <p className="mt-1.5 text-xs font-semibold text-live">
                Couldn&apos;t send. Try again.
              </p>
            )}
          </div>
        </div>

        {/* Desktop two-column layout — hidden on mobile by lg:hidden above */}
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
                  {active.peer.avatar_url ? (
                    <img
                      src={active.peer.avatar_url}
                      alt={active.peer.display_name}
                      className="size-9 rounded-full object-cover"
                    />
                  ) : (
                    <span className="grid size-9 place-items-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
                      {active.peer.display_name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">
                      {active.peer.display_name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      @{active.peer.username}
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
                    {activeMessages.map((m) => (
                      <div
                        key={m.id}
                        className={cn("flex", m.mine ? "justify-end" : "justify-start")}
                      >
                        <p
                          className={cn(
                            "max-w-[75%] break-words rounded-2xl px-3.5 py-2 text-sm leading-snug",
                            m.mine
                              ? "bg-brand text-brand-foreground"
                              : "bg-secondary text-foreground",
                          )}
                        >
                          {m.body}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
              <div className="shrink-0 border-t border-border p-3">
                <div className="flex items-center gap-2">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") send();
                    }}
                    placeholder="Message…"
                    maxLength={1000}
                    aria-label="Write a message"
                    className="min-w-0 flex-1 rounded-full bg-secondary px-4 py-2.5 text-base outline-none placeholder:text-muted-foreground md:text-sm"
                  />
                  <button
                    aria-label="Send message"
                    onClick={send}
                    disabled={!draft.trim() || thread.sending}
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-brand-foreground disabled:opacity-50"
                  >
                    <SendHorizonal className="size-4" />
                  </button>
                </div>
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

  /* ── Conversation list (no active chat on mobile) / two-column on desktop ── */
  return (
    <AppShell title="Messages" hideNav>
      <div className="lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:divide-x lg:divide-border">
        <div className={cn(selected && "hidden lg:block")}>{list}</div>
        <div className={cn(!selected && "hidden lg:flex", "min-h-[60dvh] flex-col")}>
          <div className="hidden flex-1 place-items-center px-6 text-center lg:grid">
            <p className="text-sm text-muted-foreground">
              Pick a conversation to start chatting.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
