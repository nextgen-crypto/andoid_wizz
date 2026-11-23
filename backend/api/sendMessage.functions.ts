import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { conversationId?: string; body?: string } | undefined) => ({
    conversationId: (data?.conversationId ?? "").trim(),
    body: (data?.body ?? "").trim().slice(0, 1000),
  }))
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    const senderId = (context as unknown as { userId: string }).userId;
    if (!data.body) throw new Error("Empty message.");
    if (!data.conversationId) throw new Error("Missing conversation.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Look up conversation to find receiver
    const { data: conv, error: convErr } = await supabaseAdmin
      .from("conversations")
      .select("user_a_id, user_b_id")
      .eq("id", data.conversationId)
      .single();
    if (convErr || !conv) throw new Error("Conversation not found.");

    const receiverId =
      (conv as { user_a_id: string; user_b_id: string }).user_a_id === senderId
        ? (conv as { user_a_id: string; user_b_id: string }).user_b_id
        : (conv as { user_a_id: string; user_b_id: string }).user_a_id;

    // Insert message. Try with receiver_id first (needed for realtime filtering);
    // fall back without it if the column hasn't been migrated yet.
    const withReceiver = await supabaseAdmin.from("messages").insert({
      conversation_id: data.conversationId,
      sender_id: senderId,
      receiver_id: receiverId,
      body: data.body,
    });
    if (withReceiver.error) {
      const isSchemaErr =
        withReceiver.error.code === "PGRST204" ||
        withReceiver.error.message?.includes("receiver_id") ||
        withReceiver.error.message?.includes("column");
      if (!isSchemaErr) throw withReceiver.error;
      const { error: fallbackErr } = await supabaseAdmin.from("messages").insert({
        conversation_id: data.conversationId,
        sender_id: senderId,
        body: data.body,
      });
      if (fallbackErr) throw fallbackErr;
    }

    // Send FCM push to receiver (non-blocking — don't fail the message on push error)
    void (async () => {
      try {
        const { data: senderProfile } = await supabaseAdmin
          .from("profiles")
          .select("display_name, username")
          .eq("id", senderId)
          .single();
        const name =
          (senderProfile as { display_name: string; username: string } | null)?.display_name ||
          (senderProfile as { display_name: string; username: string } | null)?.username ||
          "New message";
        const { sendFCMToUser } = await import("@/backend/lib/fcm");
        await sendFCMToUser(supabaseAdmin, receiverId, name, data.body, {
          type: "message",
          conversationId: data.conversationId,
        });
      } catch {
        // non-fatal
      }
    })();

    return { ok: true };
  });
