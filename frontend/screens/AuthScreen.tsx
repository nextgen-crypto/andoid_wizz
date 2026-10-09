import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/frontend/hooks/useSession";
import { PasswordReset } from "@/frontend/components/auth/PasswordReset";
import { formatWait, useLoginThrottle } from "@/frontend/hooks/useLoginThrottle";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

export function AuthScreen() {
  const navigate = useNavigate();
  const { session, loading: sessionLoading } = useSession();
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const throttle = useLoginThrottle(email);

  useEffect(() => {
    if (!sessionLoading && session) void navigate({ to: "/", replace: true });
  }, [session, sessionLoading, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    // Brute-force guard: three strikes per window, then a rising cooldown.
    if (mode === "signin" && throttle.locked) {
      setError(`Too many failed attempts — try again in ${formatWait(throttle.lockedSeconds)}.`);
      return;
    }

    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: name || email.split("@")[0] },
          },
        });
        if (err) {
          if (/already registered|already exists/i.test(err.message)) {
            setMode("signin");
            setNotice("Account already exists — sign in with the same email and password.");
            return;
          }
          throw err;
        }
        if (data.session) {
          // Confirm-email is OFF: session starts instantly, the watcher below redirects.
          throttle.clear();
          return;
        }
        setNotice(
          "Check your inbox and tap the confirmation link to finish creating your account.",
        );
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        throttle.clear();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Try again.";
      if (mode !== "signin") {
        setError(message);
      } else {
        const outcome = throttle.recordFailure();
        setError(
          outcome.lockedSeconds > 0
            ? `${message} Too many attempts for this email — locked for ${formatWait(outcome.lockedSeconds)}.`
            : outcome.attemptsLeft > 0
              ? `${message} ${outcome.attemptsLeft} attempt${outcome.attemptsLeft === 1 ? "" : "s"} left before a cooldown.`
              : message,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function magicLink() {
    if (!email.trim()) {
      setError("Enter your email first, then tap the magic link button.");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      if (err) throw err;
      setNotice("Sign-in link sent — tap it in your inbox and you're in, no password needed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send sign-in link.");
    } finally {
      setBusy(false);
    }
  }

  // Recovery is its own screen so the sign-in form's hooks stay untouched.
  if (resetting) {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col bg-background px-5 pb-10 pt-6 sm:px-8 sm:pt-8 md:justify-center md:border-x md:border-border">
        <Link
          to="/welcome"
          className="mb-6 inline-flex size-9 items-center justify-center rounded-full bg-secondary"
          aria-label="Back"
        >
          <ArrowLeft className="size-4 text-foreground" />
        </Link>

        <span className="text-3xl font-extrabold tracking-tight text-title">WIZZ</span>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
          Reset your password
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Recover access with your email, or the phone number on your account.
        </p>

        <PasswordReset
          onBack={() => {
            setResetting(false);
            setError(null);
            setNotice(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col bg-background px-5 pb-10 pt-6 sm:px-8 sm:pt-8 md:justify-center md:border-x md:border-border">
      <Link
        to="/welcome"
        className="mb-6 inline-flex size-9 items-center justify-center rounded-full bg-secondary"
        aria-label="Back"
      >
        <ArrowLeft className="size-4 text-foreground" />
      </Link>

      <span className="text-3xl font-extrabold tracking-tight text-title">WIZZ</span>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
        {mode === "signup" ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {mode === "signup"
          ? "Follow creators, post photos and shorts, and keep your feed in sync."
          : "Sign in to pick up your feed where you left off."}
      </p>

      <div className="mt-6 flex rounded-full bg-secondary p-1">
        {(["signup", "signin"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
              setNotice(null);
            }}
            className={cn(
              "flex-1 rounded-full py-2 text-sm font-semibold",
              mode === m ? "bg-background text-foreground shadow-raise" : "text-muted-foreground",
            )}
          >
            {m === "signup" ? "Sign up" : "Sign in"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
        {mode === "signup" && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            autoComplete="name"
            className="w-full rounded-2xl border border-border bg-secondary px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand"
          />
        )}
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="email"
          className="w-full rounded-2xl border border-border bg-secondary px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand"
        />
        <input
          required
          type="password"
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className="w-full rounded-2xl border border-border bg-secondary px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand"
        />

        {error && <p className="text-sm font-medium text-live">{error}</p>}
        {notice && <p className="text-sm font-medium text-brand">{notice}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 inline-flex items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-brand-foreground disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {mode === "signup" ? "Create account" : "Sign in"}
        </button>
        {mode === "signin" && (
          <button
            type="button"
            onClick={() => {
              setResetting(true);
              setError(null);
              setNotice(null);
            }}
            disabled={busy}
            className="self-center text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
          >
            Forgot password?
          </button>
        )}
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        onClick={magicLink}
        disabled={busy}
        className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-secondary py-3 text-sm font-semibold text-foreground disabled:opacity-60"
      >
        Email me a sign-in link instead
      </button>

      <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
        By continuing you agree to the WIZZ community guidelines and privacy policy.
      </p>
    </div>
  );
}
