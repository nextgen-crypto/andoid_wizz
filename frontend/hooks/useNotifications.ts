import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { supabase } from "@/integrations/supabase/client";
import { useSharedRealtimeChannel } from "@/frontend/hooks/realtime";
import { timeAgoCompact } from "@/frontend/lib/format";

let _notifChannelReady = false;
let _notifPermGranted: boolean | null = null;
let _notifId = 2000;

async function fireHeadsUp(title: string, body: string) {
  if (!Capacitor.isNativePlatform()) return;
  if (_notifPermGranted === null) {
    const { display } = await LocalNotifications.checkPermissions();
    if (display !== "granted") {
      const { display: after } = await LocalNotifications.requestPermissions();
      _notifPermGranted = after === "granted";
    } else {
      _notifPermGranted = true;
    }
  }
  if (!_notifPermGranted) return;
  if (!_notifChannelReady) {
    _notifChannelReady = true;
    try {
      await LocalNotifications.createChannel({
        id: "activity",
        name: "Activity",
        description: "Likes, follows, and other activity",
        importance: 4,
        vibration: true,
      });
    } catch { /* already exists */ }
  }
  try {
    await LocalNotifications.schedule({
      notifications: [{ id: _notifId++, title, body, channelId: "activity", smallIcon: "ic_notification" }],
    });
  } catch { /* non-fatal */ }
}

export interface AppNotification {
  id: string;
  kind: string;
  actor_id: string;
  actor_name: string;
  actor_username: string;
  ref_id: string;
  text: string;
  is_read: boolean;
  created_at: string;
}

/** Real inbox: own notifications + actor names, live INSERT stream. */
export function useNotifications(userId: string | null) {
  const queryClient = useQueryClient();
  const key = useMemo(() => ["notifications", userId] as const, [userId]);

  const query = useQuery({
    queryKey: key,
    enabled: Boolean(userId),
    staleTime: 15_000,
    queryFn: async (): Promise<AppNotification[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("notifications")
        .select(
          "id, kind, actor_id, ref_id, text, is_read, created_at, profiles!notifications_actor_id_fkey(username, display_name)",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (
        (data ?? []) as {
          id: string;
          kind: string;
          actor_id: string;
          ref_id: string;
          text: string;
          is_read: boolean;
          created_at: string;
          profiles: { username: string; display_name: string } | null;
        }[]
      ).map((n) => ({
        id: n.id,
        kind: n.kind,
        actor_id: n.actor_id,
        actor_name: n.profiles?.display_name ?? "Someone",
        actor_username: n.profiles?.username ?? "?",
        ref_id: n.ref_id,
        text: n.text,
        is_read: n.is_read,
        created_at: n.created_at,
      }));
    },
  });

  useSharedRealtimeChannel(userId ? `notif:${userId}` : null, (channel) => {
    channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        void queryClient.invalidateQueries({ queryKey: key });
        const row = payload.new as { kind: string; text: string };
        const title = row.kind === "follow" ? "New follower" :
                      row.kind === "like"   ? "Someone liked your post" :
                      row.kind === "blend_invite" ? "Blend invite" : "New activity";
        void fireHeadsUp(title, row.text.slice(0, 100));
      },
    );
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", userId)
        .eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const markOneRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const items = query.data ?? [];
  return {
    items,
    unread: items.filter((n) => !n.is_read).length,
    isLoading: query.isLoading,
    timeAgo: timeAgoCompact,
    markAllRead: markAllRead.mutate,
    markOneRead: markOneRead.mutate,
  };
}
