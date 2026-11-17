import { useEffect } from "react";
import { App as NativeApp } from "@capacitor/app";

import { isNativePlatform } from "@/frontend/lib/native";
import { checkForLiveUpdate, markLiveUpdateReady } from "@/frontend/lib/liveUpdate";

/**
 * Native-only OTA glue. Renders nothing.
 *
 * `ready()` tells the live-update plugin that the current bundle booted, which
 * enables its rollback protection. The first update check runs after boot; a
 * later check happens when the app resumes so a bundle published while the app
 * was backgrounded is still picked up on the next launch.
 */
export function LiveUpdateManager() {
  useEffect(() => {
    if (!isNativePlatform()) return;

    void (async () => {
      await markLiveUpdateReady();
      await checkForLiveUpdate();
    })();

    let handle: { remove: () => Promise<void> } | undefined;
    void NativeApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void checkForLiveUpdate();
    }).then((listener) => {
      handle = listener;
    });

    return () => {
      void handle?.remove();
    };
  }, []);

  return null;
}
