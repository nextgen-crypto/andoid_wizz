/**
 * send-push — Supabase Edge Function (Deno)
 *
 * Called by a pg_net DB trigger whenever a row is inserted into `notifications`.
 * Sends an FCM push notification to all registered devices for that user.
 *
 * Requires Supabase secrets (set via dashboard or `supabase secrets set`):
 *   FIREBASE_SA_JSON   — Firebase service account JSON (stringified)
 *
 * Auto-injected by Supabase:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

async function getOAuthToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  const payload = btoa(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const signingInput = `${header}.${payload}`;

  const pemContents = sa.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\n/g, "");
  const keyBuffer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sigBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const jwt = `${signingInput}.${sig}`;

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const tokenData = (await tokenResp.json()) as { access_token: string };
  return tokenData.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const saJson = Deno.env.get("FIREBASE_SA_JSON");
  if (!saJson) return new Response("FIREBASE_SA_JSON not configured", { status: 500 });

  const sa = JSON.parse(saJson) as ServiceAccount;

  const body = (await req.json()) as {
    user_id: string;
    kind: string;
    text: string;
  };

  if (!body.user_id) return new Response("missing user_id", { status: 400 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: tokens } = await supabase
    .from("push_tokens")
    .select("token")
    .eq("user_id", body.user_id);

  if (!tokens?.length) return new Response("no tokens", { status: 200 });

  const title =
    body.kind === "follow"
      ? "New follower"
      : body.kind === "like"
        ? "Someone liked your post"
        : body.kind === "comment"
          ? "New comment"
          : body.kind === "blend_invite"
            ? "Blend invite"
            : "New activity";

  const accessToken = await getOAuthToken(sa);

  const results = await Promise.allSettled(
    tokens.map((row: { token: string }) =>
      fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: row.token,
            notification: { title, body: body.text.slice(0, 100) },
            android: {
              priority: "high",
              notification: { channel_id: "activity", sound: "default" },
            },
            data: { type: "notification", kind: body.kind },
          },
        }),
      }),
    ),
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  return new Response(JSON.stringify({ sent: results.length - failed, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
