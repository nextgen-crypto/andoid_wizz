import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { supabase } from "@/integrations/supabase/client";

let permissionGranted: boolean | null = null;
let channelCreated = false;
let notifId = 1000;

async function ensurePermission(): Promise<boolean> {
  if (permissionGranted !== null) return permissionGranted;
  if (!Capacitor.isNativePlatform()) { permissionGranted = false; return false; }
  try {
    const { display } = await LocalNotifications.checkPermissions();
    if (display === "granted") { permissionGranted = true; return true; }
    const { display: after } = await LocalNotifications.requestPermissions();
    permissionGranted = after === "granted";
    return permissionGranted;
  } catch {
    permissionGranted = false;
    return false;
  }
}

async function ensureChannel() {
  if (channelCreated || !Capacitor.isNativePlatform()) return;
  channelCreated = true;
  try {
    await LocalNotifications.createChannel({
      id: "messages",
      name: "Messages",
      description: "New message notifications",
      importance: 4,
      sound: "default",
      vibration: true,
    });
  } catch { /* already exists */ }
}

async function showNotif(title: string, body: string) {
  if (!(await ensurePermission())) return;
  try {
    await LocalNotifications.schedule({
      notifications: [{ id: notifId++, title, body, channelId: "messages", smallIcon: "ic_notification" }],
    });
  } catch { /* non-fatal */ }
}

export function useMessageNotifications(userId: string | null) {
  const activeConvRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    void ensureChannel();
    void ensurePermission();

    // Use a unique channel name per mount to avoid the Supabase
    // "cannot add callbacks after subscribe()" error on re-mount
    const channelName = `notif:${userId}:${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${userId}` },
        async (payload) => {
          const row = payload.new as { conversation_id: string; sender_id: string; body: string };
          if (activeConvRef.current === row.conversation_id) return;
          const { data } = await supabase
            .from("profiles")
            .select("display_name, username")
            .eq("id", row.sender_id)
            .single();
          const name = data?.display_name || data?.username || "New message";
          void showNotif(name, row.body.slice(0, 100));
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [userId]);

  return {
    setActiveConv: (id: string | null) => { activeConvRef.current = id; },
  };
}
