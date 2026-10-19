import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

// Public origin of the production web deployment (Vercel project `wizz`).
// On native this is the only origin an outside app — a mail client, a chat
// app pasting a shared link — can actually open, so it doubles as the
// redirect target for Supabase email links.
const WEB_ORIGIN = "https://wizz-kohl.vercel.app";

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Where Supabase should send the user back after an email link.
 *
 * In the native WebView `window.location.origin` is `https://localhost`, which
 * no mail client on the planet can reach — a magic link built from it dead-ends
 * at a browser tab that isn't the app. Handing Supabase the public web origin
 * means the confirmation link at least opens a working page.
 *
 * Completing the flow *inside* the app needs a Universal/Deep Link on the
 * native side (a custom URL scheme plus an intent filter); that is not wired up
 * yet, so on native the link confirms on the web and the user signs in in-app.
 */
export function authRedirectOrigin(): string {
  if (typeof window === "undefined") return WEB_ORIGIN;
  return Capacitor.isNativePlatform() ? WEB_ORIGIN : window.location.origin;
}

/**
 * Absolute URL for a link the user copies or shares.
 *
 * On native `window.location.origin` is `https://localhost`, which only exists
 * inside this device's WebView — anyone receiving the link gets a dead URL. A
 * shared link has to open in the recipient's browser, so point it at the
 * public web deployment instead. Returns "" during SSR, matching the
 * `typeof window` guards these call sites used before.
 *
 * Named `publicUrl` rather than `shareUrl`: several of the call sites already
 * keep a local `shareUrl` variable for the link they are about to share.
 */
export function publicUrl(path: string): string {
  const base = Capacitor.isNativePlatform()
    ? WEB_ORIGIN
    : typeof window !== "undefined"
      ? window.location.origin
      : "";
  return `${base}${path}`;
}

/**
 * Open an external URL (checkout, article, share target).
 *
 * Assigning `window.location.href` navigates the WebView itself off the app
 * origin, which strands the user: the Capacitor bridge is gone and Android's
 * back button no longer returns to the app. On native the URL must open in the
 * system browser instead; in a plain browser the assignment is the normal
 * behaviour, so keep it as the fallback.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
    return;
  }
  window.location.href = url;
}
