/**
 * Server-side admin gate. Primary check is the `admin_roles` table (DB
 * role); the email allowlist (ADMIN_EMAILS server env, plus the build-time
 * VITE_ADMIN_EMAILS as a bootstrap for the very first admin) covers the
 * period before roles are seeded. The AdminScreen asks the same question
 * through the fetchAdminIdentity server function, so the UI and the server
 * can never disagree about who is an admin.
 */
export type AdminContext = {
  userId?: string;
  claims?: { email?: string; sub?: string };
};

function allowlist(): string[] {
  return ["ADMIN_EMAILS", "VITE_ADMIN_EMAILS"]
    .flatMap((key) => (process.env[key] ?? "").split(","))
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

/** True when this context may perform admin actions. Never throws. */
export async function checkIsAdmin(context: unknown): Promise<boolean> {
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
      if (!error && data) return true;
      // Table missing or unreachable → fall through to the env allowlist.
    } catch {
      // Service role key or table not configured — fall through.
    }
  }

  // 2) Email allowlist (env-configured bootstrap admins).
  const email = ctx.claims?.email?.trim().toLowerCase();
  return Boolean(email && allowlist().includes(email));
}

export async function requireAdmin(context: unknown): Promise<void> {
  if (!(await checkIsAdmin(context))) {
    throw new Error("Unauthorized: admin access required.");
  }
}
