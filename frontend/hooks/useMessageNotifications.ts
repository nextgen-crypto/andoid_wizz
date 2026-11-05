import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { supabase } from "@/integrations/supabase/client";

let permissionGranted: boolean | null = null;
let channelCreated = false;
let notifId = 1000;

// Module-level so both AppShell (hook) and MessagesScreen (setActiveConv) share it,
// and usePushNotifications can read it to suppress duplicate foreground FCM alerts.
let _activeConvId: string | null = null;

/** Call this whenever the user opens or closes a conversation. */
export function setActiveConv(id: string | null) {
  _activeConvId = id;
}

/** Read by usePushNotifications to avoid a double heads-up for the open conversation. */
export function getActiveConvId(): string | null {
  return _activeConvId;
}

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

/**
 * Subscribe to incoming DMs via Supabase Realtime and show a local heads-up.
 * Call once globally (AppShell) so it runs on every screen, not just MessagesScreen.
 */
export function useMessageNotifications(userId: string | null) {
  useEffect(() => {
    if (!userId) return;

    void ensureChannel();
    void ensurePermission();

    // Unique channel name per mount to avoid the Supabase
    // "cannot add callbacks after subscribe()" error on re-mount.
    const channelName = `notif:${userId}:${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${userId}` },
        async (payload) => {
          const row = payload.new as { conversation_id: string; sender_id: string; body: string };
          if (_activeConvId === row.conversation_id) return;
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
}
