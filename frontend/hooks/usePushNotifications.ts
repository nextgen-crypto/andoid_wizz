import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { savePushToken } from "@/backend/api/pushToken.functions";
import { getActiveConvId } from "@/frontend/hooks/useMessageNotifications";

/** Register with FCM, save the token, and show foreground push as local notification. */
export function usePushNotifications(userId: string | null) {
  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return;

    let mounted = true;

    async function setup() {
      // Request permission
      const { receive } = await PushNotifications.requestPermissions();
      if (receive !== "granted" || !mounted) return;

      // Register with FCM — fires 'registration' on success
      await PushNotifications.register();

      PushNotifications.addListener("registration", async ({ value: token }) => {
        if (!mounted) return;
        try {
          await savePushToken({ data: { token, platform: "android" } });
        } catch {
          // non-fatal
        }
      });

      // Show foreground FCM pushes as a local heads-up notification.
      // Skip message pushes for the conversation the user is currently viewing.
      PushNotifications.addListener("pushNotificationReceived", async (notification) => {
        if (!mounted) return;
        const data = notification.data as { type?: string; conversationId?: string } | undefined;
        if (data?.type === "message" && data.conversationId && data.conversationId === getActiveConvId()) return;
        try {
          await LocalNotifications.schedule({
            notifications: [
              {
                id: Date.now() % 2_147_483_647,
                title: notification.title ?? "WIZZ",
                body: notification.body ?? "",
                channelId: data?.type === "message" ? "messages" : "activity",
                smallIcon: "ic_notification",
              },
            ],
          });
        } catch {
          // non-fatal
        }
      });
    }

    void setup();

    return () => {
      mounted = false;
      void PushNotifications.removeAllListeners();
    };
  }, [userId]);
}
