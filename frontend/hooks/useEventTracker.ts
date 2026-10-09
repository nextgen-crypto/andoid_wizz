import { useCallback, useEffect, useRef } from "react";
import type { Session } from "@supabase/supabase-js";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { recordFeedEvents } from "@/backend/api/events.functions";

export type FeedEvent =
  | "video_impression"
  | "video_play"
  | "video_pause"
  | "video_progress"
  | "video_complete"
  | "video_replay"
  | "video_like"
  | "video_save"
  | "video_share"
  | "video_comment"
  | "video_skip"
  | "not_interested"
  | "hide"
  | "creator_mute";

const FLUSH_EVERY = 10;
const FLUSH_MS = 10_000;
const MAX_ATTEMPTS = 3;
const SERVER_BATCH_LIMIT = 50;

interface Queued {
  ownerId: string;
  event: FeedEvent;
  postId: string;
  authorId?: string | undefined;
  meta?: Record<string, string | number | boolean> | undefined;
  attempts: number;
}

function isPermanentServerError(error: unknown): boolean {
  const candidate =
    typeof error === "object" && error !== null
      ? (error as { message?: unknown; status?: unknown; statusCode?: unknown })
      : null;
  const status = Number(candidate?.status ?? candidate?.statusCode);
  if (status === 401 || status === 403 || status === 404) return true;
  const message = typeof candidate?.message === "string" ? candidate.message : String(error ?? "");
  return /unauthori[sz]ed|forbidden|jwt|invalid.*token|permission|row.level|schema|column|relation|not found|\b40[134]\b/i.test(
    message,
  );
}

function retryQueue(queue: Queued[], batch: Queued[]): void {
  const retried = batch
    .map((event) => ({ ...event, attempts: event.attempts + 1 }))
    .filter((event) => event.attempts < MAX_ATTEMPTS);
  const merged = [...retried, ...queue].slice(0, 200);
  queue.splice(0, queue.length, ...merged);
}

/**
 * Fire-and-forget event tracker. Batches in memory, flushes every 10 events
 * or 10 seconds. Events are account-scoped and signed-out viewers are ignored.
 * Feeds post_stats via trigger → engagement-rate ranking.
 */
export function useEventTracker(userId: string | null) {
  const recordEvents = useServerFn(recordFeedEvents);
  const queue = useRef<Queued[]>([]);
  const userRef = useRef(userId);
  userRef.current = userId;
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) tokenRef.current = data.session?.access_token ?? null;
      })
      .catch(() => undefined);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      tokenRef.current = session?.access_token ?? null;
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const flush = useCallback(async () => {
    const queued = queue.current.splice(0, queue.current.length);
    const uid = userRef.current;
    if (!uid) return;
    // Never let an event queued by A inherit B's authenticated identity.
    const batch = queued.filter((event) => event.ownerId === uid);
    if (batch.length === 0) return;

    for (let offset = 0; offset < batch.length; offset += SERVER_BATCH_LIMIT) {
      const chunk = batch.slice(offset, offset + SERVER_BATCH_LIMIT);
      // Recheck before every chunk: auth can change while an earlier RPC awaits.
      let session: Session | null = null;
      try {
        session = (await supabase.auth.getSession()).data.session;
      } catch {
        retryQueue(queue.current, chunk);
        continue;
      }
      if (!session || session.user.id !== uid) return;
      try {
        const result = await recordEvents({
          data: {
            events: chunk.map((event) => ({
              event: event.event,
              postId: event.postId,
              authorId: event.authorId,
              meta: event.meta ?? {},
            })),
          },
        });
        if (!result.ok && result.retryable) retryQueue(queue.current, chunk);
      } catch (error) {
        // Authentication, authorization, and schema failures are permanent for
        // this chunk. Only transport/transient failures consume retry attempts.
        if (!isPermanentServerError(error)) retryQueue(queue.current, chunk);
      }
    }
  }, [recordEvents]);

  /**
   * Synchronous flush for page teardown. sendBeacon is fire-and-forget and
   * cannot carry headers, so the authenticated path uses a keepalive fetch
   * with the cached access token; sendBeacon is the fallback when fetch is
   * unavailable (events are best-effort by design).
   */
  const flushSync = useCallback(() => {
    const queued = queue.current.splice(0, queue.current.length);
    const uid = userRef.current;
    if (!uid) return;
    const batch = queued.filter((event) => event.ownerId === uid);
    if (batch.length === 0) return;
    const payload = JSON.stringify({
      events: batch.map((event) => ({
        event: event.event,
        postId: event.postId,
        authorId: event.authorId,
        meta: event.meta ?? {},
      })),
    });
    const url = (recordEvents as unknown as { url?: string }).url;
    if (!url) return;
    const token = tokenRef.current;
    try {
      const blob = new Blob([payload], { type: "application/json" });
      if (typeof navigator !== "undefined" && navigator.sendBeacon?.(url, blob)) return;
    } catch {
      // fall through to keepalive fetch
    }
    void fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  }, [recordEvents]);

  useEffect(() => {
    queue.current = [];
  }, [userId]);

  useEffect(() => {
    const t = window.setInterval(() => void flush(), FLUSH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushSync();
    };
    window.addEventListener("pagehide", flushSync);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("pagehide", flushSync);
      document.removeEventListener("visibilitychange", onVisibility);
      void flush();
    };
  }, [flush, flushSync]);

  const track = useCallback(
    (event: FeedEvent, postId: string, extra?: { authorId?: string; meta?: Queued["meta"] }) => {
      if (!userId) return;
      queue.current.push({
        ownerId: userId,
        event,
        postId,
        authorId: extra?.authorId,
        meta: extra?.meta,
        attempts: 0,
      });
      if (queue.current.length >= FLUSH_EVERY) void flush();
    },
    [flush, userId],
  );

  return { track };
}
