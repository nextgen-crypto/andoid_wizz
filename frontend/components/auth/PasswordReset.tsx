import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { authRedirectOrigin } from "@/frontend/lib/native";
import { useSession } from "@/frontend/hooks/useSession";
import { sanitizeRecoveryCode, validateNewPassword } from "@/frontend/lib/passwordReset";
import { cn } from "@/lib/utils";

type Step = "request" | "verify" | "setPassword" | "done";

const inputClass =
  "w-full rounded-2xl border border-border bg-secondary px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand";

/**
 * Password recovery over email — the only channel this app has (accounts are
 * email/password, email OTP, or Google; nothing carries a phone number).
 *
 * Both ways of proving ownership converge on the same final step:
 *   1. the 6-digit recovery code from the email, entered right here; or
 *   2. the reset link in the same email — on web it lands on /reset-password
 *      with a code that detectSessionInUrl swaps for a session, and on native
 *      it opens there in the browser. Either way the session below flips this
 *      panel straight to "choose a new password" while recovery is fresh.
 *
 * The session that proof creates is exactly what updateUser({ password })
 * needs — so no step of this flow may navigate away on sign-in (the parent
 * gates its redirect while recovery is open).
 */
export function PasswordReset({ onBack, hint }: { onBack: () => void; hint?: string | undefined }) {
  const { session } = useSession();
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(hint ?? null);

  // Whichever leg proved ownership — code entered above, or link clicked in
  // the inbox — move straight to choosing the password while the session is
  // fresh. Landing here already-signed-in (the link case) counts too.
  useEffect(() => {
    if (session && step !== "done") {
      setStep("setPassword");
      setError(null);
      setNotice(null);
    }
    // step must not retrigger this: finishing the save keeps the same session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError("Enter the email on your account.");
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        // The link leg needs a route that understands a recovery session; if
        // the project's redirect allow-list doesn't know it yet, Supabase
        // falls back to the site URL and the code path below still works.
        redirectTo: `${authRedirectOrigin()}/reset-password`,
      });
      if (err) throw err;
      setStep("verify");
      setCode("");
      setNotice(
        "Recovery email sent — enter the 6-digit code from it below, or open the link inside to jump straight to a new password.",
      );
    } catch (err) {
      setError(
        err instanceof Error && err.message ? err.message : "Could not send the email. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (code.trim().length < 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: "recovery",
      });
      if (err) throw err;
      // The session the call opens trips the effect above → set-password.
      setNotice(null);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "That code didn't work. Check it and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = validateNewPassword(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setStep("done");
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Could not save the password. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    return (
      <div className="mt-5 flex flex-col items-center gap-3 text-center">
        <CheckCircle2 className="size-10 text-brand" aria-hidden="true" />
        <p className="text-sm font-semibold text-foreground">
          Password updated — you're signed in.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center justify-center rounded-full bg-brand px-8 py-3 text-sm font-bold text-brand-foreground"
        >
          Continue to WIZZ
        </button>
      </div>
    );
  }

  if (step === "verify") {
    return (
      <form onSubmit={verify} className="mt-5 flex flex-col gap-3">
        <BackButton onClick={onBack} label="Back to sign in" />
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit code sent to{" "}
          <span className="font-semibold text-foreground">{email}</span>
        </p>
        <input
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(sanitizeRecoveryCode(e.target.value))}
          placeholder="6-digit code"
          className={cn(inputClass, "text-center text-lg tracking-[0.4em]")}
        />
        {error && <p className="text-sm font-medium text-live">{error}</p>}
        {notice && <p className="text-sm font-medium text-brand">{notice}</p>}
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-brand-foreground disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Verify code
        </button>
        <button
          type="button"
          onClick={() => {
            setStep("request");
            setError(null);
            setNotice(null);
          }}
          disabled={busy}
          className="self-center text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
        >
          Use a different email
        </button>
      </form>
    );
  }

  if (step === "setPassword") {
    return (
      <form onSubmit={save} className="mt-5 flex flex-col gap-3">
        <BackButton onClick={onBack} label="Back to sign in" />
        <p className="text-sm text-muted-foreground">Choose a new password for your account.</p>
        <input
          required
          type="password"
          minLength={6}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          className={inputClass}
        />
        <input
          required
          type="password"
          minLength={6}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat new password"
          className={inputClass}
        />
        {error && <p className="text-sm font-medium text-live">{error}</p>}
        {notice && <p className="text-sm font-medium text-brand">{notice}</p>}
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-brand-foreground disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Save new password
        </button>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          At least 6 characters.
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={sendCode} className="mt-5 flex flex-col gap-3">
      <BackButton onClick={onBack} label="Back to sign in" />

      <input
        required
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email on your account"
        className={inputClass}
      />

      {error && <p className="text-sm font-medium text-live">{error}</p>}
      {notice && <p className="text-sm font-medium text-brand">{notice}</p>}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-brand-foreground disabled:opacity-60"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        Send reset code
      </button>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        We'll email a code and a link — use either to choose a new password.
      </p>
    </form>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-muted-foreground"
    >
      <ArrowLeft className="size-4" />
      {label}
    </button>
  );
}
