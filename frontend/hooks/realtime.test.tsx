// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RealtimeChannel } from "@supabase/supabase-js";

type Handler = (payload: unknown) => void;

/** Types supabase-js refuses to bind after subscribe() (isJoined || isJoining). */
const STRICT_TYPES = new Set(["postgres_changes", "presence"]);

class FakeChannel {
  state = "closed";
  topic: string;
  handlers = new Map<string, Handler[]>();
  subscribeCb: ((status: string) => void) | null = null;

  constructor(topic: string) {
    this.topic = topic;
  }

  on(type: string, _filter: unknown, cb: Handler): this {
    // Mirror RealtimeChannel.on(): strict types throw once joined/joining.
    if (STRICT_TYPES.has(type) && (this.state === "joined" || this.state === "joining")) {
      throw new Error(`cannot add \`${type}\` callbacks for ${this.topic} after \`subscribe()\`.`);
    }
    const list = this.handlers.get(type) ?? [];
    list.push(cb);
    this.handlers.set(type, list);
    return this;
  }

  async subscribe(cb?: (status: string) => void): Promise<this> {
    this.subscribeCb = cb ?? null;
    this.state = "joined";
    cb?.("joined");
    return this;
  }

  async send(): Promise<void> {}
  async track(): Promise<void> {}
  presenceState(): Record<string, unknown> {
    return {};
  }

  emit(type: string, payload: unknown): void {
    for (const cb of this.handlers.get(type) ?? []) cb(payload);
  }
}

const channels: FakeChannel[] = [];
const removeChannel = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // Mirror RealtimeClient.channel(): reuse an existing instance by topic.
    channel: vi.fn((topic: string) => {
      const existing = channels.find((c) => c.topic === topic);
      if (existing) return existing;
      const ch = new FakeChannel(topic);
      channels.push(ch);
      return ch;
    }),
    removeChannel: (ch: RealtimeChannel) => {
      removeChannel(ch);
      const i = channels.findIndex((c) => c.topic === (ch as unknown as FakeChannel).topic);
      if (i >= 0) channels.splice(i, 1);
      return Promise.resolve("ok");
    },
  },
}));

const { useSharedRealtimeChannel } = await import("./realtime");

describe("useSharedRealtimeChannel registry", () => {
  it("fans out events to every binder on the same topic", async () => {
    const a = vi.fn();
    const b = vi.fn();
    renderHook(() =>
      useSharedRealtimeChannel("topic-1", (channel) => {
        channel.on("broadcast", { event: "x" }, a);
      }),
    );
    // Second binder joins the same topic later (separate mount).
    renderHook(() =>
      useSharedRealtimeChannel("topic-1", (channel) => {
        channel.on("broadcast", { event: "x" }, b);
      }),
    );

    const topicChannels = channels.filter((c) => c.topic === "topic-1");
    const channel = topicChannels[topicChannels.length - 1];
    expect(channel).toBeDefined();
    channel!.emit("broadcast", { hello: 1 });

    expect(a).toHaveBeenCalledWith({ hello: 1 });
    expect(b).toHaveBeenCalledWith({ hello: 1 });
  });

  it("does not crash when a second postgres_changes binder joins a subscribed topic", () => {
    const filter = { event: "INSERT", schema: "public", table: "notifications" } as const;
    // First subscriber opens the channel and subscribes.
    renderHook(() =>
      useSharedRealtimeChannel("pg-topic", (channel) => {
        channel.on("postgres_changes", filter, () => undefined);
      }),
    );
    // Second subscriber registers the same filter on the now-subscribed
    // channel. Before the fix this reused the live instance and threw
    // "cannot add `postgres_changes` callbacks ... after `subscribe()`".
    expect(() =>
      renderHook(() =>
        useSharedRealtimeChannel("pg-topic", (channel) => {
          channel.on("postgres_changes", filter, () => undefined);
        }),
      ),
    ).not.toThrow();
    // Exactly one real channel for the topic (no rebuild churn).
    expect(channels.filter((c) => c.topic === "pg-topic").length).toBe(1);
  });

  it("tears down the channel when the last subscriber unmounts", () => {
    const { unmount } = renderHook(() =>
      useSharedRealtimeChannel("topic-2", (channel) => {
        channel.on("broadcast", { event: "x" }, () => undefined);
      }),
    );
    const before = removeChannel.mock.calls.length;
    unmount();
    expect(removeChannel.mock.calls.length).toBe(before + 1);
  });

  it("keeps the channel alive while any subscriber remains", () => {
    const first = renderHook(() =>
      useSharedRealtimeChannel("topic-3", (channel) => {
        channel.on("broadcast", { event: "x" }, () => undefined);
      }),
    );
    const second = renderHook(() =>
      useSharedRealtimeChannel("topic-3", (channel) => {
        channel.on("broadcast", { event: "x" }, () => undefined);
      }),
    );
    const before = removeChannel.mock.calls.length;
    first.unmount();
    expect(removeChannel.mock.calls.length).toBe(before);
    second.unmount();
    expect(removeChannel.mock.calls.length).toBe(before + 1);
  });
});
