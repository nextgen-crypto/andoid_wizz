import { defineConfig } from "vite";
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

export default defineConfig({
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
  ],
});
