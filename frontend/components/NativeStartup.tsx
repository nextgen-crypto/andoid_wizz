import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { App as NativeApp } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";

import { isNativePlatform } from "@/frontend/lib/native";

// Splash failsafe: if the bundle loads but React never reaches its first
// paint (a crash during boot), the effect inside NativeStartup never runs
// and the `launchAutoHide: false` splash would cover a dead screen forever.
// This module still executes in that case, so dismiss on a timer no matter
// what — when boot is healthy this fires seconds after the normal hide and
// the duplicate call is a no-op.
if (typeof window !== "undefined") {
  window.setTimeout(() => {
    if (isNativePlatform()) void SplashScreen.hide();
  }, 4_000);
}

/**
 * Native-only boot glue. Renders nothing.
 *
 * Two things have no web equivalent and only run here:
 *
 *  - The splash screen is configured with `launchAutoHide: false`, so nothing
 *    would ever dismiss it: without this hook the app stays on the splash
 *    forever. It is hidden after the first frame paints so the shell doesn't
 *    pop in behind it.
 *  - Android's hardware/gesture back button. Left alone it finishes the
 *    activity and closes the app; instead go back through the router when
 *    there is anywhere to go, and only minimize when the user is at the root.
 */
export function NativeStartup() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativePlatform()) return;

    const frame = requestAnimationFrame(() => {
      void SplashScreen.hide();
    });

    let handle: { remove: () => Promise<void> } | undefined;
    void NativeApp.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) {
        router.history.back();
        return;
      }
      void NativeApp.minimizeApp();
    }).then((listener) => {
      handle = listener;
    });

    return () => {
      cancelAnimationFrame(frame);
      void handle?.remove();
    };
  }, [router]);

  return null;
}
