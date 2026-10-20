// Stages the Capacitor web bundle into webDir.
//
// The native build and the Vercel build both emit through nitro's Build Output
// API, i.e. into .vercel/output. Pointing Capacitor straight at that directory
// would mean a plain `npm run build` (the SSR production build, which ships no
// index.html) silently replaces the bundle the app ships with something the
// WebView cannot load. Copying into a dedicated app-dist makes the native
// bundle independent of whichever build ran last.

import { cp, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, ".vercel/output/static");
const target = resolve(root, "app-dist");

async function main() {
  const sourceStat = await stat(source).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new Error(
      `No native build found at ${source}.\nRun \`npm run build:app\` first (or use the app:sync script, which does both).`,
    );
  }

  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });

  // Demo media for the deployed backend only — seed videos point at the web
  // origin, so bundling them would add ~4 MB to the APK for files the
  // WebView never loads.
  await rm(resolve(target, "videos"), { recursive: true, force: true });

  const shell = await stat(resolve(target, "index.html")).catch(() => null);
  if (!shell) {
    throw new Error(
      `${target} has no index.html — the last build was the SSR production build, not the app build.\nRe-run \`npm run build:app\`.`,
    );
  }

  console.log(`Native web bundle staged in ${target}`);
}

await main();
