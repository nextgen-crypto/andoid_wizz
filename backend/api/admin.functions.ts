import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkIsAdmin, requireAdmin } from "./admin-auth";

export interface AdminReport {
  id: string;
  kind: string;
  ref_id: string;
  ref_title: string;
  reporter_id: string;
  reporter_name: string;
  target_user_id: string | null;
  reason: string;
  details: string;
  status: string;
  resolution: string;
  created_at: string;
}

async function adminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function isUuid(v: string | null | undefined): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

/**
 * Server-verified admin identity. The AdminScreen gates on this instead of a
 * build-time email list, so the UI answer always matches what requireAdmin
 * will allow — one source of truth, no split-brain.
 */
export const fetchAdminIdentity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ isAdmin: boolean }> => ({
    isAdmin: await checkIsAdmin(context),
  }));

/** All reports, newest first. Requires SUPABASE_SERVICE_ROLE_KEY. */
export const fetchAdminReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      reports: AdminReport[];
      live: boolean;
    }> => {
      await requireAdmin(context);
      try {
        const db = await adminDb();
        const { data, error } = await db
          .from("reports")
          .select(
            "id, kind, ref_id, ref_title, reporter_id, target_user_id, reason, details, status, resolution, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        const rows = (data ?? []) as Omit<AdminReport, "reporter_name">[];
        const reporterIds = [...new Set(rows.map((r) => r.reporter_id))];
        const names = new Map<string, string>();
        if (reporterIds.length > 0) {
          const { data: profiles } = await db
            .from("profiles")
            .select("id, username")
            .in("id", reporterIds);
          for (const p of (profiles ?? []) as { id: string; username: string }[]) {
            names.set(p.id, p.username);
          }
        }
        return {
          live: true,
          reports: rows.map((r) => ({ ...r, reporter_name: names.get(r.reporter_id) ?? "?" })),
        };
      } catch {
        return { reports: [], live: false };
      }
    },
  );

export type ResolveAction =
  "approve" | "remove_content" | "delete_content" | "warn" | "restrict" | "suspend" | "unsuspend";

export const resolveAdminReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { id?: string; action?: ResolveAction; note?: string } | undefined) => ({
    id: data?.id ?? "",
    action: data?.action ?? "approve",
    note: (data?.note ?? "").slice(0, 300),
  }))
  .handler(async ({ context, data }): Promise<{ ok: boolean; detail: string }> => {
    await requireAdmin(context);
    if (!isUuid(data.id)) throw new Error("Report not found.");
    const db = await adminDb();
    const { data: report, error } = await db
      .from("reports")
      .select("kind, ref_id, ref_title, reason, target_user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !report) throw new Error("Report not found.");
    const r = report as {
      kind: string;
      ref_id: string;
      ref_title: string;
      reason: string;
      target_user_id: string | null;
    };
    const labels: Record<ResolveAction, string> = {
      approve: "Approved — no violation",
      remove_content: "Content hidden",
      delete_content: "Content deleted",
      warn: "User warned",
      restrict: "User restricted",
      suspend: "User suspended",
      unsuspend: "User unsuspended",
    };
    let detail = data.note || labels[data.action];

    if (data.action === "delete_content" || data.action === "remove_content") {
      // delete_content removes the row; remove_content hides it by archiving
      // the post / tombstoning the comment. Both must actually affect the
      // content — a "resolved" report that changed nothing is a lie to the
      // admin and leaves the reported content online.
      const permanent = data.action === "delete_content";
      if (r.kind === "post" && isUuid(r.ref_id)) {
        const { error: contentError } = permanent
          ? await db.from("posts").delete().eq("id", r.ref_id)
          : await db.from("posts").update({ status: "archived" }).eq("id", r.ref_id);
        if (contentError) throw contentError;
      } else if (r.kind === "comment" && isUuid(r.ref_id)) {
        const { error: contentError } = await db
          .from("comments")
          .update({ is_deleted: true })
          .eq("id", r.ref_id);
        if (contentError) throw contentError;
      } else {
        detail = "Demo content — hidden locally instead (not a database row)";
      }
    }

    if (
      (data.action === "warn" || data.action === "restrict" || data.action === "suspend") &&
      isUuid(r.target_user_id)
    ) {
      if (data.action === "warn") {
        const { error: warnError } = await db.from("warnings").insert({
          user_id: r.target_user_id,
          message:
            data.note ||
            `Your ${r.kind} "${r.ref_title.slice(0, 60)}" was reported (${r.reason}). Please follow the community guidelines.`,
        });
        if (warnError) throw warnError;
      }
      // restrict/suspend are recorded in the resolution + audit trail;
      // hard enforcement lands with the roles system.
    }

    const { error: upError } = await db
      .from("reports")
      .update({ status: "resolved", resolution: detail })
      .eq("id", data.id);
    if (upError) throw upError;
    return { ok: true, detail };
  });

/** Send a warning straight to a user's inbox. */
export const sendUserWarning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { userId?: string; message?: string } | undefined) => ({
    userId: data?.userId ?? "",
    message: (data?.message ?? "").slice(0, 300),
  }))
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    if (!isUuid(data.userId)) throw new Error("Warnings need a real user account.");
    if (!data.message.trim()) throw new Error("Write the warning first.");
    const db = await adminDb();
    const { error } = await db
      .from("warnings")
      .insert({ user_id: data.userId, message: data.message.trim() });
    if (error) throw error;
    return { ok: true };
  });

// ------------------------------------------------------- advertising console
// Backend-driven campaign review. Reads/writes via service_role so admins can
// moderate any advertiser's campaign; the AdminScreen gates access client-side
// (desktop-only, VITE_ADMIN_EMAILS). Degrades to live:false when part5 tables
// are missing — the UI keeps the legacy local AdManager working.

export interface AdminCampaign {
  id: string;
  name: string;
  objective: string;
  status: string;
  package: string;
  budget_cents: number;
  spend_cents: number;
  currency: string;
  placement: string;
  impressions: number;
  clicks: number;
  engagements: number;
  hides: number;
  cta_label: string;
  advertiser_id: string;
  advertiser_name: string;
  post_id: string | null;
  post_caption: string;
  created_at: string;
}

export const fetchAdminCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ campaigns: AdminCampaign[]; live: boolean }> => {
    await requireAdmin(context);
    try {
      const db = await adminDb();
      const { data, error } = await db
        .from("ad_campaigns")
        .select(
          "id, name, objective, status, package, budget_cents, spend_cents, currency, placement, impressions, clicks, engagements, hides, cta_label, advertiser_id, post_id, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = (data ?? []) as Omit<AdminCampaign, "advertiser_name" | "post_caption">[];
      const advIds = [...new Set(rows.map((r) => r.advertiser_id))];
      const postIds = [...new Set(rows.map((r) => r.post_id).filter((v): v is string => !!v))];
      const names = new Map<string, string>();
      const captions = new Map<string, string>();
      if (advIds.length > 0) {
        const { data: profiles } = await db
          .from("profiles")
          .select("id, username")
          .in("id", advIds);
        for (const p of (profiles ?? []) as { id: string; username: string }[]) {
          names.set(p.id, p.username);
        }
      }
      if (postIds.length > 0) {
        const { data: posts } = await db.from("posts").select("id, caption").in("id", postIds);
        for (const p of (posts ?? []) as { id: string; caption: string }[]) {
          captions.set(p.id, p.caption);
        }
      }
      return {
        live: true,
        campaigns: rows.map((r) => ({
          ...r,
          advertiser_name: names.get(r.advertiser_id) ?? "?",
          post_caption: r.post_id ? (captions.get(r.post_id) ?? "") : "",
        })),
      };
    } catch {
      return { campaigns: [], live: false };
    }
  });

export type CampaignReviewAction = "approve" | "reject" | "pause" | "resume" | "complete";

const CAMPAIGN_STATUS: Record<CampaignReviewAction, string> = {
  approve: "active",
  reject: "rejected",
  pause: "paused",
  resume: "active",
  complete: "completed",
};

export const reviewAdminCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { id?: string; action?: CampaignReviewAction; note?: string } | undefined) => ({
    id: data?.id ?? "",
    action: (data?.action ?? "approve") as CampaignReviewAction,
    note: (data?.note ?? "").slice(0, 300),
  }))
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    if (!isUuid(data.id)) throw new Error("Campaign not found.");
    if (!CAMPAIGN_STATUS[data.action]) throw new Error("Bad action.");
    const db = await adminDb();
    const patch =
      data.action === "reject"
        ? { status: "rejected" as const, rejection_reason: data.note }
        : { status: CAMPAIGN_STATUS[data.action] };
    const { error } = await db.from("ad_campaigns").update(patch).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ------------------------------------------------- news & trending moderation
// news_stories / trending_topics ship with public-SELECT-only RLS, so the
// admin console's direct browser writes always failed with an RLS violation.
// Every mutation goes through these service-role server functions instead,
// gated by requireAdmin — the same pattern as the campaign console.

export const adminSaveNewsStory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (
      data:
        | {
            id?: string;
            headline?: string;
            summary?: string;
            category?: string;
            state?: string;
          }
        | undefined,
    ) => ({
      id: data?.id ?? "",
      headline: (data?.headline ?? "").trim().slice(0, 200),
      summary: (data?.summary ?? "").trim().slice(0, 2000),
      category: (data?.category ?? "General").trim().slice(0, 40),
      state: (data?.state ?? "developing").trim().slice(0, 20),
    }),
  )
  .handler(async ({ context, data }): Promise<{ ok: boolean; id: string }> => {
    await requireAdmin(context);
    if (!data.headline) throw new Error("Headline is required.");
    const db = await adminDb();
    if (data.id) {
      if (!isUuid(data.id)) throw new Error("Story not found.");
      const { error } = await db
        .from("news_stories")
        .update({
          headline: data.headline,
          summary: data.summary,
          category: data.category,
          state: data.state,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id);
      if (error) throw error;
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await db
      .from("news_stories")
      .insert({
        headline: data.headline,
        summary: data.summary,
        category: data.category,
        state: data.state,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ok: true, id: (row as { id: string }).id };
  });

export const adminDeleteNewsStory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { id?: string } | undefined) => ({ id: data?.id ?? "" }))
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    if (!isUuid(data.id)) throw new Error("Story not found.");
    const db = await adminDb();
    const { error } = await db.from("news_stories").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const adminCreateTrendingTopic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { label?: string; context?: string; postCount?: number } | undefined) => ({
    label: (data?.label ?? "").trim().slice(0, 80),
    context: (data?.context ?? "").trim().slice(0, 120),
    postCount: Math.min(Math.max(Math.floor(data?.postCount ?? 0), 0), 1_000_000),
  }))
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    if (!data.label) throw new Error("Topic label is required.");
    const db = await adminDb();
    const { data: rows, error: rankError } = await db
      .from("trending_topics")
      .select("rank")
      .order("rank", { ascending: false })
      .limit(1);
    if (rankError) throw rankError;
    const maxRank = (rows as { rank: number }[] | null)?.[0]?.rank ?? 0;
    const { error } = await db.from("trending_topics").insert({
      label: data.label,
      context: data.context,
      post_count: data.postCount,
      rank: maxRank + 1,
    });
    if (error) throw error;
    return { ok: true };
  });

export const adminDeleteTrendingTopic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { id?: string } | undefined) => ({ id: data?.id ?? "" }))
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    if (!isUuid(data.id)) throw new Error("Topic not found.");
    const db = await adminDb();
    const { error } = await db.from("trending_topics").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ------------------------------------------------------------------- roles
// admin_roles is the authoritative gate (see admin-auth.ts). These functions
// manage its rows so admins can be granted/revoked from the console instead
// of only through raw SQL. Degrades gracefully when the table is missing.

export interface AdminRoleRow {
  user_id: string;
  email: string;
  created_at: string;
}

/** Resolve an auth email to its user id via the GoTrue admin API. Pages
 * through listUsers (no email filter in the JS client); caps at 500 accounts. */
async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
    if (error || !data?.users?.length) return null;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 100) return null;
  }
  return null;
}

export const fetchAdminRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ roles: AdminRoleRow[]; live: boolean }> => {
    await requireAdmin(context);
    try {
      const db = await adminDb();
      const { data, error } = await db
        .from("admin_roles")
        .select("user_id, email, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return { roles: (data ?? []) as AdminRoleRow[], live: true };
    } catch {
      return { roles: [], live: false };
    }
  });

export const grantAdminRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { email?: string } | undefined) => ({
    email: (data?.email ?? "").trim().toLowerCase().slice(0, 120),
  }))
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
      throw new Error("That doesn't look like an email address.");
    }
    const userId = await findAuthUserIdByEmail(data.email);
    if (!userId) throw new Error("No account found with that email address.");
    const db = await adminDb();
    const { error } = await db
      .from("admin_roles")
      .upsert({ user_id: userId, email: data.email }, { onConflict: "user_id" });
    if (error) throw error;
    return { ok: true };
  });

export const revokeAdminRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { userId?: string } | undefined) => ({ userId: data?.userId ?? "" }))
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    if (!isUuid(data.userId)) throw new Error("User not found.");
    const db = await adminDb();
    const { error } = await db.from("admin_roles").delete().eq("user_id", data.userId);
    if (error) throw error;
    return { ok: true };
  });

// Verified badges are a paid perk (see subscriptions.functions.ts): the
// badge is written with the Premium period, so the console deliberately has
// no manual grant and no review queue.
