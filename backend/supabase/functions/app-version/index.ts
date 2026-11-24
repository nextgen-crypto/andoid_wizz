import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Bump LATEST_VERSION_CODE here whenever you publish a new mandatory update to Play Store.
// The Android app compares its build number against this value and prompts if behind.
const LATEST_VERSION_CODE = 41;

serve((_req) => {
  return new Response(
    JSON.stringify({ latest_version_code: LATEST_VERSION_CODE }),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
});
