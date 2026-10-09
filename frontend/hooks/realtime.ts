import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

type Bind = (channel: RealtimeChannel) => void | (() => void);

interface Sub {
  bindRef: { current: Bind };
  onStatusRef: { current: ((status: string, channel: RealtimeChannel) => void) | undefined };
  teardown?: (() => void) | undefined;
}

interface Entry {
  refs: number;
  channel: RealtimeChannel;
  subs: Map<symbol, Sub>;
}

const registry = new Map<string, Entry>();

function statusFanout(entry: Entry, channel: RealtimeChannel): (status: string) => void {
  return (status: string) => {
    for (const sub of entry.subs.values()) sub.onStatusRef.current?.(status, channel);
  };
}

function openChannel(topic: string, entry: Entry): RealtimeChannel {
  const channel = supabase.channel(topic);
  for (const sub of entry.subs.values()) {
    sub.teardown = sub.bindRef.current(channel) ?? undefined;
  }
  channel.subscribe(statusFanout(entry, channel));
  return channel;
}

/**
 * Refcounted shared realtime subscription.
 *
 * supabase-js reuses channel instances by topic, and calling .on() on an
 * already-subscribed instance THROWS for postgres_changes/presence. With
 * shared hooks (badge + sheet both listening, StrictMode remounts), naive
 * subscribe-per-mount crashes the whole tree.
 *
 * Every subscriber is a first-class binder: all binder callbacks are applied
 * before subscribe() so each subscriber receives events. When a binder
 * subscribes to an already-open topic, the channel is rebuilt once (all
 * current binders re-applied to a fresh channel) so its handlers attach
 * pre-subscribe — fan-out is preserved, exactly one channel per topic.
 */
export function useSharedRealtimeChannel(
  topic: string | null,
  bind: (channel: RealtimeChannel) => void | (() => void),
  onStatus?: (status: string, channel: RealtimeChannel) => void,
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
      entry = { refs: 0, channel: null as unknown as RealtimeChannel, subs: new Map() };
      entry.subs.set(id, { bindRef, onStatusRef });
      entry.channel = openChannel(topic, entry);
      registry.set(topic, entry);
    } else {
      entry.subs.set(id, { bindRef, onStatusRef });
      // Rebuild once so the new binder's handlers attach before subscribe().
      const next = supabase.channel(topic);
      for (const sub of entry.subs.values()) {
        sub.teardown = sub.bindRef.current(next) ?? undefined;
      }
      next.subscribe(statusFanout(entry, next));
      const previous = entry.channel;
      entry.channel = next;
      void supabase.removeChannel(previous);
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
