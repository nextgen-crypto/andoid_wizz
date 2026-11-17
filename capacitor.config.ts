/// <reference types="@capawesome/capacitor-live-update" />

import type { CapacitorConfig } from "@capacitor/cli";

// The native shell ships its web assets inside the APK: there is no
// server.url, so the app boots from local files and never depends on a Vercel
// deployment being reachable. `npm run build:app` builds a client-only SPA
// shell (WIZZ_TARGET=app) and scripts/copy-app-bundle.mjs stages it into
// webDir, which keeps the SSR production build from clobbering it.
const config: CapacitorConfig = {
  // Play Store package id — must be unique, reverse-domain style. Changing it
  // later forces every installed build to uninstall/reinstall (no updates).
  appId: "com.wizz.mobile",
  appName: "WIZZ",
  webDir: "app-dist",
  server: {
    // Capacitor's default scheme for Android; kept explicit so the WebView
    // origin stays `https://localhost`. Absolute /assets/... URLs in the
    // built shell resolve against it.
    androidScheme: "https",
    cleartext: false,
  },
  android: {
    // Matches the web app's dark `--background` (oklch(0.145 0.008 285)) so
    // the window never flashes white while the shell loads.
    backgroundColor: "#0a0a0d",
  },
  plugins: {
    // Web bundles are downloaded from our own Supabase bucket (see
    // scripts/publish-live-update.mjs). No Capawesome Cloud account required.
    LiveUpdate: {
      autoBlockRolledBackBundles: true,
      autoDeleteBundles: true,
      // We drive self-hosted checks from LiveUpdateManager, so the plugin's
      // cloud-based automatic strategy stays off.
      autoUpdateStrategy: "none",
      readyTimeout: 10_000,
    },
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#0a0a0d",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
    StatusBar: {
      // Light icons, because the app background is dark.
      style: "LIGHT",
      backgroundColor: "#0a0a0d",
    },
  },
};

export default config;
