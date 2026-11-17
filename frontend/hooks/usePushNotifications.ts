import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { savePushToken } from "@/backend/api/pushToken.functions";
import { getActiveConvId } from "@/frontend/hooks/useMessageNotifications";

/**
 * Whether this native build can safely call Firebase.
 *
 * `PushNotifications.register()` calls FirebaseMessaging.getInstance(), which
 * throws if there is no default FirebaseApp. That happens whenever the Google
 * Services Gradle plugin was skipped because android/app/google-services.json
 * is missing. Capacitor rethrows plugin exceptions on the main thread, so the
 * crash is a native process death — not a catchable JS rejection. Vite bakes
 * this flag from the file's presence at build time.
 */
const FCM_CONFIGURED =
  typeof __WIZZ_FCM_CONFIGURED__ !== "undefined" && __WIZZ_FCM_CONFIGURED__;

/** One registration for the lifetime of the WebView, not one per screen. */
let configuredFor: string | null = null;
let generation = 0;
let removeListeners: (() => void) | null = null;

function resetPush() {
  generation += 1;
  configuredFor = null;
  removeListeners?.();
  removeListeners = null;
  // Also clear any listeners left by an older bundle/user in this process.
  void PushNotifications.removeAllListeners().catch(() => {});
}

async function setupPush(userId: string, setupGeneration: number) {
  try {
    const { receive } = await PushNotifications.requestPermissions();
    if (receive !== "granted" || setupGeneration !== generation) return;

    // Safe only when Firebase is actually configured; see FCM_CONFIGURED.
    await PushNotifications.register();
    if (setupGeneration !== generation) return;

    const registration = await PushNotifications.addListener(
      "registration",
      async ({ value: token }) => {
        if (setupGeneration !== generation) return;
        try {
          await savePushToken({ data: { token, platform: "android" } });
        } catch {
          // non-fatal
        }
      },
    );

    // Show foreground FCM pushes as a local heads-up notification.
    // Skip message pushes for the conversation the user is currently viewing.
    const received = await PushNotifications.addListener(
      "pushNotificationReceived",
      async (notification) => {
        if (setupGeneration !== generation) return;
        const data = notification.data as
          | { type?: string; conversationId?: string }
          | undefined;
        if (
          data?.type === "message" &&
          data.conversationId &&
          data.conversationId === getActiveConvId()
        ) {
          return;
        }
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
      },
    );

    if (setupGeneration !== generation) {
      void registration.remove();
      void received.remove();
      return;
    }

    removeListeners = () => {
      void registration.remove();
      void received.remove();
    };
  } catch {
    // Push is optional. Never let a notification failure take down the shell.
  }
}

/** Register with FCM once, save the token, and show foreground push locally. */
export function usePushNotifications(userId: string | null) {
  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform() || !FCM_CONFIGURED) {
      if (!userId) resetPush();
      return;
    }

    if (configuredFor === userId) return;

    resetPush();
    configuredFor = userId;
    void setupPush(userId, generation);
  }, [userId]);
}
