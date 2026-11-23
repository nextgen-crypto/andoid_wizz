import { createSign } from "node:crypto";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

let _cachedToken: string | null = null;
let _tokenExpiry = 0;

async function getOAuthToken(): Promise<string> {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) return _cachedToken;

  const saJson = process.env["FIREBASE_SA_JSON"];
  if (!saJson) throw new Error("FIREBASE_SA_JSON env var not set");

  const sa = JSON.parse(saJson) as ServiceAccount;
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  ).toString("base64url");

  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(sa.private_key, "base64url");

  const jwt = `${header}.${payload}.${sig}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + data.expires_in * 1000;
  return _cachedToken;
}

export async function sendFCM(
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  const saJson = process.env["FIREBASE_SA_JSON"];
  if (!saJson) return; // FCM not configured — skip silently

  const { project_id } = JSON.parse(saJson) as ServiceAccount;
  const accessToken = await getOAuthToken();

  const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${project_id}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        android: {
          priority: "high",
          notification: { channel_id: "messages", sound: "default" },
        },
        data: data ?? {},
      },
    }),
  });

  if (!resp.ok) {
    console.error("FCM send failed:", await resp.text());
  }
}

/** Send a push notification to all FCM tokens registered for a user. */
export async function sendFCMToUser(
  supabaseAdmin: { from: (t: string) => unknown },
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  if (!process.env["FIREBASE_SA_JSON"]) return;

  const { data: rows } = (await (
    supabaseAdmin.from("push_tokens") as {
      select: (c: string) => {
        eq: (...args: unknown[]) => Promise<{ data: { token: string }[] | null }>;
      };
    }
  )
    .select("token")
    .eq("user_id", userId)) as { data: { token: string }[] | null };

  if (!rows?.length) return;
  await Promise.allSettled(rows.map((r) => sendFCM(r.token, title, body, data)));
}
