import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { supabase } from "@/integrations/supabase/client";

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
 * Where Supabase OAuth (Google) should send the user back after consent.
 *
 * On native the return leg has to land back inside the app, so it points at
 * the custom-scheme deep link the manifest's intent filter claims
 * (`com.wizz.mobile://login-callback`). The client runs PKCE, so the one-time
 * code rides in the query string — which survives the browser → app hand-off,
 * unlike a fragment. Must also be allow-listed in Supabase Auth → URL
 * Configuration. On web the plain origin is the correct target (auth-js then
 * auto-exchanges the code via `detectSessionInUrl`).
 */
export function oauthRedirectTo(): string {
  if (typeof window === "undefined") return WEB_ORIGIN;
  return Capacitor.isNativePlatform() ? "com.wizz.mobile://login-callback" : window.location.origin;
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
 * Server functions live on the deployed backend, not in this bundle: nitro only
 * emits them while building for Vercel, and the native shell is a folder of
 * static files served by Capacitor from `https://localhost`. So a bare
 * `fetch("/_serverFn/fetchHome")` reaches the file server, comes back as HTML,
 * and the RPC fetcher throws — which is the "Feed unavailable" screen the home
 * route shows when its loader rejects.
 *
 * This forwards every `/_serverFn/*` request to the public deployment. It goes
 * out through Capacitor's *native* HTTP stack instead of the WebView's `fetch`
 * on purpose: a cross-origin browser request would need CORS preflight and
 * headers that the deployment doesn't send for every function id, while native
 * requests aren't subject to CORS at all. The bearer token already rides along
 * in `Authorization`, which the server middleware reads, so no session
 * information is lost by leaving the WebView.
 */
const SERVER_FN_PREFIX = "/_serverFn/";
let rpcBridgeInstalled = false;

function requestUrlOf(input: RequestInfo | URL): URL | null {
  try {
    const raw =
      typeof input === "string"
        ? new URL(input, window.location.origin).href
        : input instanceof URL
          ? input.href
          : typeof Request !== "undefined" && input instanceof Request
            ? input.url
            : null;
    return raw ? new URL(raw) : null;
  } catch {
    return null;
  }
}

function headerRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  const record: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function toNativeResponse(result: {
  status: number;
  headers?: Record<string, string>;
  data?: unknown;
}): Response {
  const status = result.status;
  // Capacitor reports 0 when the connection never completed. `fetch` signals
  // that with a rejected TypeError, and react-query keys its retry/backoff off
  // exactly that shape, so mirror it rather than inventing a status code.
  if (!Number.isFinite(status) || status < 200 || status >= 600) {
    throw new TypeError("Failed to fetch");
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    if (value == null) continue;
    try {
      headers.set(key, String(value));
    } catch {
      // Skip headers the Headers API rejects (e.g. invalid names).
    }
  }

  // 204/205/304 must not carry a body, and the Response constructor enforces it.
  const bodiless = status === 204 || status === 205 || status === 304;
  let body: string | null = null;
  if (!bodiless && result.data != null) {
    // Capacitor parses `application/json` for us; the RPC fetcher wants the
    // raw payload, so re-stringify. Framed (`application/x-tss-framed`) and
    // HTML error responses arrive as text and pass through untouched.
    body = typeof result.data === "string" ? result.data : JSON.stringify(result.data);
  }

  return new Response(body, { status, headers });
}

/**
 * Route server-function calls to the deployed backend. Must run before any
 * route loader executes, so it is invoked at module load and again from
 * `getRouter()`. Idempotent, and a no-op outside the native shell.
 */
export function installNativeRpcBridge(): void {
  if (rpcBridgeInstalled) return;
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if (!Capacitor.isNativePlatform()) return;
  rpcBridgeInstalled = true;

  const passthrough = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = requestUrlOf(input);
    if (!target || !target.pathname.startsWith(SERVER_FN_PREFIX)) return passthrough(input, init);

    // Server-function payloads are always JSON strings; anything more exotic
    // (FormData uploads, streams) keeps the stock path instead of being
    // flattened by hand here.
    const body = typeof init?.body === "string" ? init.body : null;
    if (init?.body != null && body === null) return passthrough(input, init);

    // TanStack always calls `fetch(url, init)`, but accept the Request form
    // too so a future caller doesn't silently lose its headers.
    const source = typeof Request !== "undefined" && input instanceof Request ? input : null;
    const headers = { ...headerRecord(source?.headers), ...headerRecord(init?.headers) };
    // Java's HttpURLConnection treats `Origin` as restricted and drops it on
    // some devices, so start.ts also accepts a request that carries none.
    headers["Origin"] = WEB_ORIGIN;

    const method = (init?.method ?? source?.method ?? "GET").toUpperCase();
    // A Request carrying its own body can't be re-read synchronously here;
    // let the browser send those as-is rather than dropping the payload.
    if (source?.body != null && init?.body == null) return passthrough(input, init);

    return CapacitorHttp.request({
      url: `${WEB_ORIGIN}${target.pathname}${target.search}`,
      method,
      headers,
      ...(body === null ? {} : { data: body }),
      readTimeout: 30_000,
      connectTimeout: 30_000,
    }).then(
      (result) => toNativeResponse(result),
      () => {
        throw new TypeError("Failed to fetch");
      },
    );
  };
}

// Load-time install: route loaders can fire before React ever mounts.
installNativeRpcBridge();

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

/**
 * Turn the OAuth `?code=` deep link into a session.
 *
 * Google hands the flow to the system browser, Supabase redirects back to
 * `com.wizz.mobile://login-callback?code=…`, and Android delivers that intent
 * to this running shell instead of the WebView ever navigating itself.
 * exchangeCodeForSession consumes the single-use code and persists the
 * session exactly like the web leg does.
 */
async function completeOAuthReturn(url?: string): Promise<void> {
  if (!url) return;
  try {
    const code = new URL(url).searchParams.get("code");
    if (code) await supabase.auth.exchangeCodeForSession(code);
  } catch {
    // Malformed URL or already-consumed code: the session watcher simply
    // stays signed out, which is the safe default for an auth return leg.
  }
}

let oauthReturnInstalled = false;

/**
 * Listen for the OAuth return deep link. Two entry points cover both process
 * states: `getLaunchUrl` when Android recreated the activity straight from the
 * VIEW intent (user finished in Chrome after the app was backgrounded/killed),
 * and `appUrlOpen` when the singleTask activity was still alive. Idempotent,
 * and a no-op outside the native shell.
 */
export function installOAuthReturnHandler(): void {
  if (oauthReturnInstalled || typeof window === "undefined") return;
  if (!Capacitor.isNativePlatform()) return;
  oauthReturnInstalled = true;
  void App.getLaunchUrl().then((result) => completeOAuthReturn(result?.url));
  void App.addListener("appUrlOpen", ({ url }) => completeOAuthReturn(url));
}

// Load-time install too, but deliberately below the `let` it closes over —
// the intent can arrive before React ever mounts, same as the RPC bridge.
installOAuthReturnHandler();
