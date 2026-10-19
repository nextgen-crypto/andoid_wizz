import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
  // The native shell has no browser fetch to inspect: its requests leave
  // through Capacitor's HTTP stack, which sends no Sec-Fetch-Site, Origin or
  // Referer (and Java drops Origin as a restricted header anyway). That reads
  // as "no evidence either way", so without this every APK call would 403.
  // Browsers still always send Sec-Fetch-Site, so cross-site page requests are
  // rejected exactly as before; and auth is a bearer token read from
  // localStorage rather than a cookie, so a foreign page can't act as the
  // signed-in user even if it got a request through.
  allowRequestsWithoutOriginCheck: true,
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
