/**
 * Client-side error reporting hook for the root error boundary.
 *
 * Pluggable telemetry: set VITE_SENTRY_DSN (and optionally VITE_SENTRY_ENV)
 * to forward errors to Sentry; without a DSN this is a no-op console logger,
 * so local/dev runs never break on a missing key.
 */

declare global {
  interface Window {
    Sentry?: {
      captureException: (error: unknown, context?: Record<string, unknown>) => void;
      init?: (options: Record<string, unknown>) => void;
    };
  }
}

let sentryReady: boolean | null = null;

function sentry(): NonNullable<Window["Sentry"]> | null {
  if (sentryReady !== null) return sentryReady ? (window.Sentry ?? null) : null;
  const dsn = import.meta.env?.["VITE_SENTRY_DSN"] as string | undefined;
  if (!dsn || typeof window === "undefined" || !window.Sentry) {
    sentryReady = false;
    return null;
  }
  try {
    window.Sentry.init?.({
      dsn,
      environment: (import.meta.env?.["VITE_SENTRY_ENV"] as string | undefined) ?? "production",
    });
    sentryReady = true;
    return window.Sentry;
  } catch {
    sentryReady = false;
    return null;
  }
}

export function reportAppError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const message =
    error instanceof Response
      ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);
  const payload = {
    route: window.location.pathname,
    ...context,
    ...(error instanceof Error && { stack: error.stack }),
  };
  const client = sentry();
  if (client) {
    try {
      client.captureException(error, { extra: payload });
      return;
    } catch {
      // fall through to console
    }
  }
  console.error("[wizz]", message, payload);
}
