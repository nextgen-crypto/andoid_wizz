import { useState } from "react";
import { ArrowLeft, Loader2, Mail, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { authRedirectOrigin } from "@/frontend/lib/native";
import { cn } from "@/lib/utils";

type Channel = "email" | "phone";
type Step = "request" | "verify" | "setPassword";

const inputClass =
  "w-full rounded-2xl border border-border bg-secondary px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand";

/**
 * Password recovery over either channel.
 *
 * Email: Supabase emails a reset link (works today — provider is enabled).
 * Phone: an SMS code proves ownership, then the session it opens is used to
 * set the new password. Only accounts that actually carry a phone number can
 * be reached this way, and the SMS provider must be configured — when it
 * isn't, we say so plainly instead of failing silently.
 */
export function PasswordReset({ onBack }: { onBack: () => void }) {
  const [channel, setChannel] = useState<Channel>("email");
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Supabase says "phone provider is disabled" in a few different words. */
  function readable(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err ?? "");
    if (/phone|sms|twilio/i.test(raw) && /disab|not configured|no.*provider|enable/i.test(raw)) {
      return "SMS recovery isn't enabled yet on this project. Add your Twilio credentials in Supabase → Auth → Providers → Phone, or use email instead.";
    }
    return raw || "That didn't work. Try again.";
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (channel === "email") {
      if (!email.trim()) {
        setError("Enter the email on your account.");
        return;
      }
      setBusy(true);
      try {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: authRedirectOrigin(),
        });
        if (err) throw err;
        setNotice("Reset link sent — open it in your inbox to choose a new password.");
      } catch (err) {
        setError(readable(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    // Phone — Supabase wants E.164 ("+255712345678").
    const e164 = phone.replace(/[\s()-]/g, "");
    if (!/^\+\d{8,15}$/.test(e164)) {
      setError("Enter your number in international format, e.g. +255712345678.");
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.signInWithOtp({ phone: e164 });
      if (err) throw err;
      setNotice("Code sent by SMS — enter it below.");
      setStep("verify");
    } catch (err) {
      setError(readable(err));
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
        phone: phone.replace(/[\s()-]/g, ""),
        token: code.trim(),
        type: "sms",
      });
      if (err) throw err;
      setStep("setPassword");
      setNotice("Verified — now choose a new password.");
    } catch (err) {
      setError(readable(err));
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Use at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setNotice("Password updated — sign in with it now.");
      setStep("request");
      setPassword("");
      setCode("");
      setChannel("email");
    } catch (err) {
      setError(readable(err));
    } finally {
      setBusy(false);
    }
  }

  if (step === "verify") {
    return (
      <form onSubmit={verify} className="mt-5 flex flex-col gap-3">
        <BackButton onClick={onBack} label="Reset password" />
        <p className="text-sm text-muted-foreground">
          Enter the code sent to <span className="font-semibold text-foreground">{phone}</span>
        </p>
        <input
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
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
          Change number
        </button>
      </form>
    );
  }

  if (step === "setPassword") {
    return (
      <form onSubmit={save} className="mt-5 flex flex-col gap-3">
        <BackButton onClick={onBack} label="Reset password" />
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
      </form>
    );
  }

  return (
    <form onSubmit={sendCode} className="mt-5 flex flex-col gap-3">
      <BackButton onClick={onBack} label="Back to sign in" />

      <div className="flex rounded-full bg-secondary p-1">
        {(["email", "phone"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setChannel(c);
              setError(null);
              setNotice(null);
            }}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-sm font-semibold",
              channel === c
                ? "bg-background text-foreground shadow-raise"
                : "text-muted-foreground",
            )}
          >
            {c === "email" ? <Mail className="size-4" /> : <Smartphone className="size-4" />}
            {c === "email" ? "Email" : "Phone"}
          </button>
        ))}
      </div>

      {channel === "email" ? (
        <input
          required
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email on your account"
          className={inputClass}
        />
      ) : (
        <input
          required
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+255712345678"
          className={inputClass}
        />
      )}

      {error && <p className="text-sm font-medium text-live">{error}</p>}
      {notice && <p className="text-sm font-medium text-brand">{notice}</p>}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-brand-foreground disabled:opacity-60"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {channel === "email" ? "Email me a reset link" : "Send code by SMS"}
      </button>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        {channel === "email"
          ? "We'll send a link that lets you choose a new password."
          : "Use the phone number on your account — the SMS code is valid for 10 minutes."}
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
