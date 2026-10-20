import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BadgeCheck, CircleDashed, CircleX, Undo2 } from "lucide-react";
import { confirmPremiumCheckout } from "@/backend/api/billing.functions";

/**
 * Stripe Checkout return page (https://wizz-kohl.vercel.app/checkout).
 *
 * Stripe redirects here after success or cancellation — in the app that is
 * the system browser, where there is no app session, so confirmation runs
 * unauthenticated against Stripe itself (`confirmPremiumCheckout` grants only
 * the account Stripe recorded on the session *we* created, and only when
 * paid). The user then closes the tab; the app's own polling picks up the
 * granted badge.
 */

export const Route = createFileRoute("/checkout")({
  head: () => ({
    meta: [{ title: "WIZZ Premium — Checkout" }, { name: "robots", content: "noindex" }],
  }),
  component: CheckoutPage,
});

type Phase = "idle" | "confirming" | "confirmed" | "pending" | "failed" | "cancelled";

const copy: Record<Phase, { title: string; body: string }> = {
  idle: {
    title: "WIZZ Premium",
    body: "Open WIZZ and tap Subscribe to start your checkout.",
  },
  confirming: {
    title: "Confirming your payment…",
    body: "Hang on a moment while Stripe verifies the transaction.",
  },
  confirmed: {
    title: "You're subscribed!",
    body: "Your verified badge is live — close this tab and head back to the WIZZ app.",
  },
  pending: {
    title: "Payment received",
    body: "Your subscription is being set up — the verified badge appears within a minute.",
  },
  failed: {
    title: "Still processing",
    body: "We couldn't confirm this yet. If you were charged, your badge will appear shortly.",
  },
  cancelled: {
    title: "Checkout cancelled",
    body: "You haven't been charged. Subscribe any time from Settings › WIZZ Premium.",
  },
};

function CheckoutPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const started = useRef(false);

  async function confirm(sessionId: string): Promise<void> {
    setPhase("confirming");
    try {
      const result = await confirmPremiumCheckout({ data: { sessionId } });
      setPhase(result.ok ? "confirmed" : result.reason === "pending" ? "pending" : "failed");
    } catch {
      setPhase("failed");
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("cancelled") === "1") {
      setPhase("cancelled");
      return;
    }
    const sessionId = params.get("session_id");
    if (sessionId) void confirm(sessionId);
  }, []);

  const sessionId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("session_id")
      : null;
  const Icon =
    phase === "confirmed"
      ? BadgeCheck
      : phase === "cancelled" || phase === "failed"
        ? CircleX
        : CircleDashed;
  const message = copy[phase];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-brand/10">
        <Icon className="size-9 text-brand" strokeWidth={2.25} />
      </span>
      <div>
        <h1 className="text-xl font-bold text-foreground">{message.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message.body}</p>
      </div>
      <div className="flex w-full flex-col gap-2">
        {phase === "failed" && sessionId && (
          <button
            onClick={() => void confirm(sessionId)}
            className="w-full rounded-full bg-brand py-3 text-sm font-bold text-brand-foreground"
          >
            Check again
          </button>
        )}
        <a
          href="/"
          className={`w-full rounded-full py-3 text-sm font-bold ${phase === "failed" && sessionId ? "bg-secondary text-foreground" : "bg-brand text-brand-foreground"}`}
        >
          {phase === "confirmed" ? "Back to WIZZ" : "Open WIZZ"}
        </a>
      </div>
      {phase === "cancelled" && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Undo2 className="size-3.5" /> Nothing was charged.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Payments are processed securely by Stripe.
      </p>
    </main>
  );
}
