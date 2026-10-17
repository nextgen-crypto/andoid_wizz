import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

type Bind = (channel: RealtimeChannel) => void | (() => void);
type StatusCb = (status: string, channel: RealtimeChannel) => void;

interface Sub {
  bindRef: { current: Bind };
  onStatusRef: { current: StatusCb | undefined };
  teardown?: (() => void) | undefined;
}

interface Entry {
  refs: number;
  channel: RealtimeChannel;
  /** Deduping wrapper handed to binders; see makeBinderChannel. */
  binderChannel: RealtimeChannel;
  subs: Map<symbol, Sub>;
  /** `${type}:${filter}` -> every callback registered for that listener. */
  dispatchers: Map<string, Set<(payload: unknown) => void>>;
}

const registry = new Map<string, Entry>();

/**
 * Wrap a channel so binders' `.on()` calls are deduped per (type, filter).
 *
 * supabase-js reuses channel instances by topic and THROWS when you add a
 * postgres_changes/presence callback after subscribe(). Because every filter
 * in this app is derived from the topic key, independent subscribers to one
 * topic always register the *same* filter — so we attach each unique listener
 * exactly once (before the first subscribe) and fan events out to every
 * callback registered under it. A late subscriber just joins the existing
 * fan-out and never touches the live channel's `.on()`.
 */
function makeBinderChannel(entry: Entry, channel: RealtimeChannel): RealtimeChannel {
  return new Proxy(channel, {
    get(target, prop, receiver) {
      if (prop !== "on") {
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      // Intercept .on() to dedupe by (type, filter).
      return (type: string, filter: unknown, callback: (payload: unknown) => void) => {
        const key = `${type}:${JSON.stringify(filter ?? null)}`;
        let set = entry.dispatchers.get(key);
        const isNew = !set;
        if (!set) {
          set = new Set();
          entry.dispatchers.set(key, set);
        }
        // Capture in a const so the dispatcher closure sees a definite Set.
        const callbacks = set;
        if (isNew) {
          const dispatcher = (payload: unknown) => {
            for (const cb of callbacks) cb(payload);
          };
          try {
            (
              target as unknown as {
                on: (t: string, f: unknown, cb: (p: unknown) => void) => void;
              }
            ).on(type, filter, dispatcher);
          } catch (error) {
            // A genuinely new filter arriving after subscribe(): supabase-js
            // refuses it. Degrade to a no-op listener rather than crash.
            console.warn("[realtime] could not attach listener after subscribe:", error);
          }
        }
        callbacks.add(callback);
        return receiver;
      };
    },
  }) as RealtimeChannel;
}

function statusFanout(entry: Entry): (status: string) => void {
  return (status: string) => {
    for (const sub of entry.subs.values()) sub.onStatusRef.current?.(status, entry.binderChannel);
  };
}

function openChannel(topic: string, entry: Entry): RealtimeChannel {
  const channel = supabase.channel(topic);
  entry.channel = channel;
  entry.binderChannel = makeBinderChannel(entry, channel);
  for (const sub of entry.subs.values()) {
    sub.teardown = sub.bindRef.current(entry.binderChannel) ?? undefined;
  }
  channel.subscribe(statusFanout(entry));
  return channel;
}

/**
 * Refcounted shared realtime subscription.
 *
 * Exactly one real channel per topic. Every subscriber is a binder whose
 * `.on()` registrations are deduped (see makeBinderChannel) and applied before
 * the single subscribe(), so each subscriber receives events without ever
 * adding a postgres_changes/presence callback to an already-subscribed channel.
 * On the last unmount the channel is removed.
 */
export function useSharedRealtimeChannel(
  topic: string | null,
  bind: (channel: RealtimeChannel) => void | (() => void),
  onStatus?: StatusCb,
) {
  const bindRef = useRef<Bind>(bind);
  bindRef.current = bind;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) idRef.current = Symbol(topic ?? "realtime");

  useEffect(() => {
    if (!topic) return;
    const id = idRef.current!;
    let entry = registry.get(topic);
    if (!entry) {
      entry = {
        refs: 0,
        channel: null as unknown as RealtimeChannel,
        binderChannel: null as unknown as RealtimeChannel,
        subs: new Map(),
        dispatchers: new Map(),
      };
      entry.subs.set(id, { bindRef, onStatusRef });
      registry.set(topic, entry);
      openChannel(topic, entry);
    } else {
      entry.subs.set(id, { bindRef, onStatusRef });
      // Apply the new binder through the deduping proxy. Repeat filters only
      // join the existing fan-out — no live .on(), so no post-subscribe throw.
      const sub = entry.subs.get(id)!;
      sub.teardown = sub.bindRef.current(entry.binderChannel) ?? undefined;
    }
    entry.refs += 1;
    return () => {
      const e = registry.get(topic);
      if (!e) return;
      e.refs -= 1;
      const sub = e.subs.get(id);
      sub?.teardown?.();
      e.subs.delete(id);
      if (e.refs <= 0) {
        registry.delete(topic);
        void supabase.removeChannel(e.channel);
      }
    };
  }, [topic]);
}
