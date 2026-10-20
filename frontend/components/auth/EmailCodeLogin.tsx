import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { authRedirectOrigin } from "@/frontend/lib/native";
import { useLoginThrottle, formatWait } from "@/frontend/hooks/useLoginThrottle";
import {
  isValidCode,
  normalizeCode,
  normalizeEmailForOtp,
  readableCodeError,
  resendAvailable,
  resendSecondsLeft,
} from "@/frontend/lib/otp";
import { cn } from "@/lib/utils";

type Step = "request" | "verify";

const inputClass =
  "w-full rounded-2xl border border-border bg-secondary px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand";

/**
 * Passwordless sign-in with an emailed verification code.
 *
 * Supabase signInWithOtp() mails a code; verifyOtp({ type: "email" }) exchanges
 * it for a session — no password, no deep link, which is why this is the flow
 * that actually works inside the native shell (magic links bounce to a browser).
 *
 * The session it opens is picked up by useSession() in AuthScreen, which
 * navigates home on its own; this component never routes itself.
 */
export function EmailCodeLogin({
  mode,
  name,
  onBack,
}: {
  mode: "signin" | "signup";
  name?: string;
  onBack: () => void;
}) {
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const throttle = useLoginThrottle(email);
  const codeRef = useRef<HTMLInputElement | null>(null);

  // Resend countdown — mirrors Supabase's own ~1/min OTP send limit.
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (step !== "verify" || sentAt === null) return;
    const tick = () => {
      const left = resendSecondsLeft(sentAt, Date.now());
      setCooldown(left);
      if (left <= 0 && countdownTimer.current) {
        clearInterval(countdownTimer.current);
        countdownTimer.current = null;
      }
    };
    countdownTimer.current = setInterval(tick, 1000);
    tick();
    return () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    };
  }, [step, sentAt]);

  useEffect(() => {
    if (step === "verify") codeRef.current?.focus();
  }, [step]);

  async function send(targetEmail?: string) {
    const cleaned = normalizeEmailForOtp(targetEmail ?? email);
    if (!cleaned) {
      setError("Enter a valid email address.");
      return;
    }
    if (throttle.locked) {
      setError(`Too many attempts — locked for ${formatWait(throttle.lockedSeconds)}.`);
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: cleaned,
        options: {
          shouldCreateUser: mode === "signup",
          emailRedirectTo: authRedirectOrigin(),
          // Carried into user_metadata for accounts created by this flow.
          ...(mode === "signup" && name?.trim() ? { data: { full_name: name.trim() } } : {}),
        },
      });
      if (err) throw err;
      setEmail(cleaned);
      setSentAt(Date.now());
      setStep("verify");
      // Mentions the link too: if the project's template still renders
      // {{ .ConfirmationURL }}, the email shows a link — that path also works.
      setNotice(
        `Code sent to ${cleaned} — enter it below. Link in the email instead? Tap it and you're in.`,
      );
    } catch (err) {
      setError(readableCodeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    // Lock check first: a locked-out user must be told they're locked, not
    // asked for a code they can't use.
    if (throttle.locked) {
      setError(`Too many attempts — locked for ${formatWait(throttle.lockedSeconds)}.`);
      return;
    }
    const token = normalizeCode(code);
    if (!isValidCode(token)) {
      setError("Enter the full code from the email (6–8 digits).");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "email",
      });
      if (err) throw err;
      // Session is set — AuthScreen's useSession() watcher navigates home.
      throttle.clear();
    } catch (err) {
      const outcome = throttle.recordFailure();
      const message = readableCodeError(err);
      setError(
        outcome.lockedSeconds > 0
          ? `${message} Too many attempts — locked for ${formatWait(outcome.lockedSeconds)}.`
          : outcome.attemptsLeft > 0
            ? `${message} ${outcome.attemptsLeft} attempt${outcome.attemptsLeft === 1 ? "" : "s"} left before a cooldown.`
            : message,
      );
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  if (step === "verify") {
    return (
      // noValidate: our own 6–8 digit check gives the clearer message.
      <form onSubmit={verify} noValidate className="mt-5 flex flex-col gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 self-start text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </button>

        <input
          ref={codeRef}
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="6–8 digit code"
          maxLength={8}
          className={cn(inputClass, "text-center text-lg font-bold tracking-[0.4em]")}
        />

        {error && <p className="text-sm font-medium text-live">{error}</p>}
        {notice && <p className="text-sm font-medium text-brand">{notice}</p>}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-brand-foreground disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Verify and sign in
        </button>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Didn't get it? Check spam.</span>
          <button
            type="button"
            onClick={() => {
              setCode("");
              void send(email);
            }}
            disabled={busy || cooldown > 0}
            className="font-semibold text-brand underline-offset-2 hover:underline disabled:text-muted-foreground disabled:no-underline"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      // We render our own readable errors; native bubbles are less clear.
      noValidate
      className="mt-5 flex flex-col gap-3"
    >
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 self-start text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
      >
        <ArrowLeft className="size-3.5" />
        Back
      </button>

      <input
        required
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
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
        {mode === "signup" ? "Create account with code" : "Email me a code"}
      </button>
    </form>
  );
}
