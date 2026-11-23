import { Capacitor } from "@capacitor/core";
import { LiveUpdate } from "@capawesome/capacitor-live-update";
import { onlineManager } from "@tanstack/react-query";

import { reportAppError } from "@/lib/error-reporting";

/**
 * Runtime web bundles are hosted in the public Supabase `app-bundles` bucket.
 * The native APK stays installed; the app checks this manifest on launch and
 * (on resume) downloads a new web bundle for the next start. Any failure keeps
 * the currently shipped bundle, so update delivery can never blank the app.
 */
export interface LiveUpdateManifest {
  bundleId: string;
  url: string;
  checksum?: string;
  minNativeVersionCode?: number;
  releasedAt?: string;
}

const CHECK_INTERVAL = 15 * 60 * 1000;
const LAST_CHECK_KEY = "wizz:last-live-update-check";

function manifestUrl(): string | null {
  const configured = import.meta.env["VITE_APP_UPDATE_MANIFEST_URL"];
  if (configured) return configured;
  const projectUrl = import.meta.env["VITE_SUPABASE_URL"];
  if (!projectUrl) return null;
  return `${projectUrl.replace(/\/$/, "")}/storage/v1/object/public/app-bundles/manifest.json`;
}

function lastCheck(): number {
  try {
    return Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function recordCheck(): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    // Storage can be unavailable in private mode; checking again is harmless.
  }
}

async function isCompatible(manifest: LiveUpdateManifest): Promise<boolean> {
  if (!manifest.minNativeVersionCode) return true;
  try {
    const { versionCode } = await LiveUpdate.getVersionCode();
    return Number(versionCode) >= manifest.minNativeVersionCode;
  } catch {
    return false;
  }
}

const NATIVE_VC_KEY = "wizz:native-version-code";

/**
 * Must be called on every native start, before any bundle-changing method.
 *
 * Also guards against a stale live-update bundle masking a freshly installed
 * APK: when the native versionCode changes (new APK installed) we reset the
 * plugin back to the built-in assets so the user immediately sees the latest
 * code. The next checkForLiveUpdate() will re-download a matching bundle.
 */
export async function markLiveUpdateReady(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    // Detect new APK install by comparing stored vs current versionCode.
    const { versionCode } = await LiveUpdate.getVersionCode();
    const storedVc = localStorage.getItem(NATIVE_VC_KEY);
    if (storedVc !== String(versionCode)) {
      // New APK installed — reset to built-in bundle.
      await LiveUpdate.reset();
      localStorage.setItem(NATIVE_VC_KEY, String(versionCode));
      // reset() only marks the built-in bundle as "next"; it does NOT take
      // effect until reload() is called. Without reload() the old OTA bundle
      // stays active for the entire session and changes appear only on the
      // next cold start (which users often don't do).
      await LiveUpdate.reload();
      return; // WebView is restarting — nothing further needed this session.
    }
    await LiveUpdate.ready();
  } catch (error) {
    reportAppError(error, { boundary: "live_update_ready" });
  }
}

/**
 * Check for a published web bundle, download it, and schedule it for the next
 * app launch. Never reloads the WebView while the user is in the app.
 */
export async function checkForLiveUpdate(force = false): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!onlineManager.isOnline()) return;

  const url = manifestUrl();
  if (!url) return;
  if (!force && Date.now() - lastCheck() < CHECK_INTERVAL) return;
  recordCheck();

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return;
    const manifest = (await response.json()) as LiveUpdateManifest;
    if (!manifest?.bundleId || !manifest.url) return;

    const [current, next] = await Promise.all([
      LiveUpdate.getCurrentBundle(),
      LiveUpdate.getNextBundle(),
    ]);
    if (current.bundleId === manifest.bundleId || next.bundleId === manifest.bundleId) return;
    if (!(await isCompatible(manifest))) return;

    await LiveUpdate.downloadBundle({
      bundleId: manifest.bundleId,
      url: manifest.url,
      ...(manifest.checksum ? { checksum: manifest.checksum } : {}),
    });
    await LiveUpdate.setNextBundle({ bundleId: manifest.bundleId });
    // Intentionally no reload(): the update is applied on the next launch.
  } catch (error) {
    reportAppError(error, { boundary: "live_update_check" });
  }
}
