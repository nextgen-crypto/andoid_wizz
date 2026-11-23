import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const savePushToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { token?: string; platform?: string } | undefined) => ({
    token: (data?.token ?? "").trim().slice(0, 512),
    platform: (data?.platform ?? "android").slice(0, 20),
  }))
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    const userId = (context as unknown as { userId: string }).userId;
    if (!data.token) throw new Error("Missing FCM token.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("push_tokens")
      .upsert(
        { user_id: userId, token: data.token, platform: data.platform },
        { onConflict: "token" },
      );
    if (error) throw error;
    return { ok: true };
  });
