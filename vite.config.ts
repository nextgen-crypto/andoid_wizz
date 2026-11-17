import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Two build targets share this config:
//
//   default          SSR + Build Output API -> Vercel production deployment.
//   WIZZ_TARGET=app  Static SPA shell       -> bundled into the Capacitor APK.
//
// The app target must produce a real index.html on disk, because the native
// WebView loads it from the package instead of from a server — and the SSR
// build emits none (nitro's Build Output API writes static assets plus a
// server function). TanStack Start's SPA mode fills that gap: it renders a
// client-only shell and masks every route onto it. Dropping SSR on native
// loses nothing user-visible, because every route re-fetches its data in the
// browser (server functions are bridged to the deployed backend by
// frontend/lib/native.ts). The vercel preset still builds a server function
// for the web deploy; its static assets are what the WebView loads.
const isNativeApp = process.env["WIZZ_TARGET"] === "app";

// Firebase Cloud Messaging only has a default FirebaseApp when the native
// build applied the Google Services Gradle plugin, which in turn only happens
// when android/app/google-services.json exists. Calling
// PushNotifications.register() without it throws inside the native plugin;
// Capacitor rethrows that on the main thread and the process dies. Bake the
// file's presence into the JS bundle so the hook can stay off when FCM is not
// configured.
const fcmConfigured = existsSync(resolve(process.cwd(), "android/app/google-services.json"));

// The SPA-shell build writes every artifact (index.html + assets) and logs
// "[prerender] Prerendered 1 pages", but the process can then sit forever on
// a lingering handle from the prerender pipeline and never exit — which
// hangs `npm run build:app` and everything chained after it. The prerendered
// shell is the pipeline's final artifact, so: clear any stale shell up
// front, wait for a fresh one to land, then exit. App target only — the web
// build exits on its own.
function exitAppBuild(): Plugin {
  const shell = resolve(process.cwd(), ".vercel/output/static/index.html");
  let enabled = false;
  let exiting = false;
  return {
    name: "wizz-exit-app-build",
    apply: "build",
    buildStart() {
      if (!isNativeApp) return;
      enabled = true;
      // Make "shell exists" a reliable completion signal for this run.
      rmSync(shell, { force: true });
    },
    closeBundle() {
      if (!enabled || exiting) return;
      exiting = true;
      const deadline = Date.now() + 120_000;
      const timer = setInterval(() => {
        if (existsSync(shell) || Date.now() > deadline) {
          clearInterval(timer);
          // A beat for any trailing asset writes after the shell lands.
          setTimeout(() => process.exit(0), 3000);
        }
      }, 400);
    },
  };
}

export default defineConfig({
  define: {
    __WIZZ_FCM_CONFIGURED__: JSON.stringify(fcmConfigured),
  },
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({
      srcDirectory: "./frontend",
      // The native bundle needs a real index.html on disk. SPA mode emits a
      // client-only shell — no route data is fetched at build time, so the
      // build never needs Supabase to be reachable — and the client router
      // owns every navigation from there. The default outputPath would write
      // `_shell.html`, which a WebView has no rewrites to route to, so emit
      // `index.html` directly; Capacitor always loads that at the root.
      ...(isNativeApp ? { spa: { enabled: true, prerender: { outputPath: "/index" } } } : {}),
    }),
    nitro({ preset: "vercel" }),
    viteReact(),
    exitAppBuild(),
  ],
});
