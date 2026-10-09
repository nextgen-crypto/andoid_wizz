import { useCallback, useEffect, useRef, useState } from "react";
import { notifyBlendInvite } from "@/backend/api/notify.functions";
import { supabase } from "@/integrations/supabase/client";
import { useSharedRealtimeChannel } from "@/frontend/hooks/realtime";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface BlendInvite {
  roomId: string;
  fromId: string;
  fromName: string;
  shortId: string;
}

export interface BlendSession {
  roomId: string;
  peerId: string;
  peerName: string;
  isHost: boolean;
}

export interface BlendRemoteState {
  shortId: string;
  playing: boolean;
  time: number;
}

export interface BlendReaction {
  id: number;
  emoji: string;
  mine: boolean;
}

interface InboxPayload {
  type: "invite" | "accept" | "decline";
  roomId: string;
  fromId: string;
  fromName: string;
  shortId?: string;
}

interface RoomPayload {
  type: "state" | "react";
  shortId?: string;
  playing?: boolean;
  time?: number;
  emoji?: string;
  from?: string;
}

const REQUEST_TIMEOUT_MS = 45_000;

let reactionSeq = 0;

/**
 * Followers-only co-watching ("Blend"). Signalling runs over Supabase
 * Realtime broadcast + presence — no tables, no migrations.
 * - inbox channel  `blend-inbox:{userId}`  — invites, accept/decline
 * - room channel   `blend-room:{roomId}`   — presence, playback state, reactions
 */
export function useBlend({
  userId,
  displayName,
  onRemoteState,
}: {
  userId: string | null;
  displayName: string;
  onRemoteState: (s: BlendRemoteState) => void;
}) {
  const [incoming, setIncoming] = useState<BlendInvite | null>(null);
  const [requesting, setRequesting] = useState<{ toId: string; toName: string } | null>(null);
  const [requestFailed, setRequestFailed] = useState<string | null>(null);
  const [session, setSession] = useState<BlendSession | null>(null);
  const [peerHere, setPeerHere] = useState(false);
  const [reactions, setReactions] = useState<BlendReaction[]>([]);

  const onRemoteStateRef = useRef(onRemoteState);
  onRemoteStateRef.current = onRemoteState;
  const sessionRef = useRef<BlendSession | null>(null);
  sessionRef.current = session;
  const roomChannelRef = useRef<RealtimeChannel | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const pushReaction = useCallback((emoji: string, mine: boolean) => {
    const id = ++reactionSeq;
    setReactions((prev) => [...prev.slice(-5), { id, emoji, mine }]);
    window.setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id));
    }, 1800);
  }, []);

  const clearRequestTimeout = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Inbox: invites + accept/decline.
  useSharedRealtimeChannel(userId ? `blend-inbox:${userId}` : null, (channel) => {
    channel.on("broadcast", { event: "blend" }, ({ payload }) => {
      const msg = payload as InboxPayload;
      if (msg.type === "invite") {
        setIncoming({
          roomId: msg.roomId,
          fromId: msg.fromId,
          fromName: msg.fromName,
          shortId: msg.shortId ?? "",
        });
      } else if (msg.type === "accept") {
        setRequesting((req) => {
          if (req && req.toId === msg.fromId) {
            setSession({
              roomId: msg.roomId,
              peerId: msg.fromId,
              peerName: msg.fromName,
              isHost: true,
            });
            clearRequestTimeout();
            return null;
          }
          return req;
        });
      } else if (msg.type === "decline") {
        setRequesting((req) => {
          if (req && req.toId === msg.fromId) {
            clearRequestTimeout();
            setRequestFailed(`${msg.fromName} declined.`);
            window.setTimeout(() => setRequestFailed(null), 3000);
            return null;
          }
          return req;
        });
      }
    });
  });

  // Room: presence + playback state + reactions.
  useSharedRealtimeChannel(
    session && userId ? `blend-room:${session.roomId}` : null,
    (channel) => {
      roomChannelRef.current = channel;
      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState<{ user_id: string }>();
          const others = Object.values(state)
            .flat()
            .some((p) => p.user_id !== userId);
          setPeerHere(others);
        })
        .on("broadcast", { event: "blend" }, ({ payload }) => {
          const msg = payload as RoomPayload;
          if (msg.type === "state" && msg.shortId !== undefined) {
            const current = sessionRef.current;
            if (!current) return;
            onRemoteStateRef.current({
              shortId: msg.shortId,
              playing: msg.playing ?? false,
              time: msg.time ?? 0,
            });
          } else if (msg.type === "react" && msg.emoji) {
            pushReaction(msg.emoji, msg.from === userId);
          }
        });
      return () => {
        roomChannelRef.current = null;
        setPeerHere(false);
      };
    },
    async (status, channel) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ user_id: userId as string, name: displayName });
      }
    },
  );

  useEffect(() => clearRequestTimeout, [clearRequestTimeout]);

  // Reusable per-peer channels: subscribe once, send many, tear down on unmount.
  const peerChannels = useRef(new Map<string, RealtimeChannel>());
  useEffect(() => {
    const cache = peerChannels.current;
    return () => {
      for (const ch of cache.values()) void supabase.removeChannel(ch);
      cache.clear();
    };
  }, []);
  const peerChannel = useCallback(async (topic: string) => {
    let channel = peerChannels.current.get(topic);
    if (!channel) {
      channel = supabase.channel(topic);
      peerChannels.current.set(topic, channel);
    }
    if (channel.state !== "joined" && channel.state !== "joining") {
      await channel.subscribe();
    }
    return channel;
  }, []);

  const sendInvite = useCallback(
    async (toId: string, toName: string, shortId: string) => {
      if (!userId || requesting || session) return;
      const roomId = `room-${userId.slice(0, 8)}-${Date.now().toString(36)}`;
      setRequestFailed(null);
      setRequesting({ toId, toName });
      const channel = await peerChannel(`blend-inbox:${toId}`);
      await channel.send({
        type: "broadcast",
        event: "blend",
        payload: {
          type: "invite",
          roomId,
          fromId: userId,
          fromName: displayName,
          shortId,
        } satisfies InboxPayload,
      });
      // Persisted inbox copy for closed apps (best-effort).
      notifyBlendInvite({ data: { toUserId: toId, roomId, shortId } }).catch(() => undefined);
      timeoutRef.current = window.setTimeout(() => {
        setRequesting(null);
        setRequestFailed("No answer — try again later.");
        window.setTimeout(() => setRequestFailed(null), 3000);
      }, REQUEST_TIMEOUT_MS);
    },
    [userId, displayName, requesting, session],
  );

  const replyInvite = useCallback(
    async (accept: boolean) => {
      if (!userId || !incoming) return;
      const channel = await peerChannel(`blend-inbox:${incoming.fromId}`);
      await channel.send({
        type: "broadcast",
        event: "blend",
        payload: {
          type: accept ? "accept" : "decline",
          roomId: incoming.roomId,
          fromId: userId,
          fromName: displayName,
        } satisfies InboxPayload,
      });
      if (accept) {
        setSession({
          roomId: incoming.roomId,
          peerId: incoming.fromId,
          peerName: incoming.fromName,
          isHost: false,
        });
      }
      setIncoming(null);
    },
    [userId, displayName, incoming],
  );

  const leaveSession = useCallback(() => {
    setSession(null);
    setPeerHere(false);
  }, []);

  const cancelRequest = useCallback(() => {
    clearRequestTimeout();
    setRequesting(null);
  }, [clearRequestTimeout]);

  const broadcastState = useCallback(async (state: BlendRemoteState) => {
    if (!sessionRef.current) return;
    // Send on the live subscription — a throwaway instance on another topic
    // would never reach the peer, and reusing the room topic would fight it.
    const live = roomChannelRef.current;
    if (!live) return;
    await live.send({
      type: "broadcast",
      event: "blend",
      payload: { type: "state", ...state } satisfies RoomPayload,
    });
  }, []);

  const sendReaction = useCallback(
    async (emoji: string) => {
      const current = sessionRef.current;
      if (!current || !userId) return;
      pushReaction(emoji, true);
      const live = roomChannelRef.current;
      if (!live) return;
      await live.send({
        type: "broadcast",
        event: "blend",
        payload: { type: "react", emoji, from: userId } satisfies RoomPayload,
      });
    },
    [userId, pushReaction],
  );

  return {
    incoming,
    requesting,
    requestFailed,
    session,
    peerHere,
    reactions,
    sendInvite,
    replyInvite,
    leaveSession,
    cancelRequest,
    broadcastState,
    sendReaction,
  };
}
