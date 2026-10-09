/**
 * Server-side admin gate. Primary check is the `admin_roles` table (DB
 * role); the legacy email allowlist is only a development fallback so a
 * fresh checkout keeps working before roles are seeded. Production deploys
 * must set ADMIN_EMAILS empty and grant rows in `admin_roles` instead.
 */
export type AdminContext = {
  userId?: string;
  claims?: { email?: string; sub?: string };
};

function allowlist(): string[] {
  const server = (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const legacy =
    process.env["NODE_ENV"] !== "production"
      ? (process.env["VITE_ADMIN_EMAILS"] ?? "")
          .split(",")
          .map((v) => v.trim().toLowerCase())
          .filter(Boolean)
      : [];
  return [...server, ...legacy];
}

export async function requireAdmin(context: unknown): Promise<void> {
  const ctx = (context ?? {}) as AdminContext;

  // 1) DB role check — authoritative.
  if (typeof ctx.userId === "string" && ctx.userId.length > 0) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin
        .from("admin_roles")
        .select("user_id")
        .eq("user_id", ctx.userId)
        .maybeSingle();
      if (!error && data) return;
      // Table missing or unreachable → fall through to the env allowlist.
    } catch {
      // Service role key or table not configured — fall through.
    }
  }

  // 2) Env allowlist fallback (dev / bootstrap only).
  const email = ctx.claims?.email?.trim().toLowerCase();
  if (email && allowlist().includes(email)) return;

  throw new Error("Unauthorized: admin access required.");
}
