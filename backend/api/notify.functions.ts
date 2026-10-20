import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cap per actor so one account can't flood anyone's inbox with invites. */
const INVITE_CAP_PER_DAY = 50;

/**
 * Blend invite inbox entry. The realtime broadcast wakes open apps; this row
 * survives for closed ones. Caller is validated — you can only invite AS you.
 */
export const notifyBlendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { toUserId?: string; roomId?: string; shortId?: string } | undefined) => ({
    toUserId: data?.toUserId ?? "",
    roomId: (data?.roomId ?? "").slice(0, 80),
    shortId: (data?.shortId ?? "").slice(0, 80),
  }))
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    const fromId = (context as unknown as { userId: string }).userId;
    if (!UUID_RE.test(data.toUserId) || data.toUserId === fromId) {
      throw new Error("Bad invite target.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("actor_id", fromId)
      .eq("kind", "blend_invite")
      .gte("created_at", dayAgo);
    if ((count ?? 0) >= INVITE_CAP_PER_DAY) {
      throw new Error("Invite limit reached — try again later.");
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", fromId)
      .maybeSingle();
    const name = ((profile as { display_name?: string } | null)?.display_name ?? "Someone").slice(
      0,
      40,
    );
    const { error } = await supabaseAdmin.from("notifications").insert({
      user_id: data.toUserId,
      kind: "blend_invite",
      actor_id: fromId,
      ref_id: data.roomId,
      text: `invited you to watch together${data.shortId ? " (short)" : ""} — ${name}`,
    });
    if (error) throw error;
    return { ok: true };
  });
