import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/frontend/hooks/useSession";
import { PasswordReset } from "@/frontend/components/auth/PasswordReset";
import { formatWait, useLoginThrottle } from "@/frontend/hooks/useLoginThrottle";
import {
  authRedirectOrigin,
  describeOAuthError,
  oauthRedirectTo,
  onOAuthReturnError,
  openExternalUrl,
} from "@/frontend/lib/native";
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
    // Recovery opens the moment verifyOtp hands back a session — that session
    // is fuel for setting the new password, so the redirect must wait until
    // the reset panel is closed.
    if (!sessionLoading && session && !resetting) void navigate({ to: "/", replace: true });
  }, [session, sessionLoading, resetting, navigate]);

  useEffect(() => {
    // OAuth failures have to reach the user, or "Google login failed" has no
    // cause to act on. Two legs, one message channel:
    //  - native: the deep-link exchange in native.ts publishes failures here
    //    (it also replays one that fired before this screen mounted);
    //  - web: GoTrue bounces back with ?error=…&error_description=…, which
    //    auth-js clears from the URL without surfacing — read it once, then
    //    clean the URL so a reload doesn't replay the same banner.
    const unsubscribe = onOAuthReturnError((message) => {
      setNotice(null);
      setError(message);
    });
    try {
      const url = new URL(window.location.href);
      const fromQuery = url.searchParams.get("error") ?? url.searchParams.get("error_code") ?? null;
      const fromHash = new URLSearchParams(url.hash.replace(/^#/, "")).get("error");
      const errCode = fromQuery ?? fromHash;
      if (errCode) {
        const description =
          url.searchParams.get("error_description") ??
          new URLSearchParams(url.hash.replace(/^#/, "")).get("error_description");
        setError(describeOAuthError(errCode, description));
        url.search = "";
        url.hash = "";
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
    } catch {
      // URL parsing unavailable — the form still works without the banner.
    }
    return unsubscribe;
  }, []);

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
            emailRedirectTo: authRedirectOrigin(),
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
        options: { emailRedirectTo: authRedirectOrigin() },
      });
      if (err) throw err;
      setNotice("Sign-in link sent — tap it in your inbox and you're in, no password needed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send sign-in link.");
    } finally {
      setBusy(false);
    }
  }

  async function googleSignIn() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { data, error: err } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: oauthRedirectTo(),
          // Google refuses OAuth inside an in-app WebView, and auth-js's
          // default auto-redirect would strand the native shell off-origin.
          // Take the flow to the system browser instead; the manifest's
          // login-callback intent filter brings it back with the PKCE code,
          // which installOAuthReturnHandler() exchanges for the session.
          skipBrowserRedirect: true,
        },
      });
      if (err) throw err;
      if (!data.url) throw new Error("Google sign-in is unavailable right now.");
      // Google bounces with "redirect_uri_mismatch" whenever the project
      // baked into this build isn't the one Google's client is configured
      // for — an APK built against a stale .env. Verify the pairing here,
      // where the message can name the cause, instead of stranding the user
      // on Google's opaque 400 page.
      const projectUrl = (import.meta.env["VITE_SUPABASE_URL"] ?? "").replace(/\/$/, "");
      if (projectUrl) {
        const expected = `${projectUrl}/auth/v1/callback`;
        const actual = new URL(data.url).searchParams.get("redirect_uri")?.replace(/\/$/, "");
        if (actual && actual !== expected) {
          throw new Error(
            "This build of WIZZ talks to a different Supabase project than Google allows — install the newest APK build.",
          );
        }
      }
      await openExternalUrl(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  // Recovery is its own screen so the sign-in form's hooks stay untouched.
  if (resetting) {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col bg-background px-5 pb-10 pt-safe sm:px-8 md:justify-center md:border-x md:border-border">
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
          We'll email you a code and a link — use either to choose a new password.
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
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col bg-background px-5 pb-10 pt-safe sm:px-8 md:justify-center md:border-x md:border-border">
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
        onClick={googleSignIn}
        disabled={busy}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-secondary py-3 text-sm font-semibold text-foreground disabled:opacity-60"
      >
        <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
          />
          <path
            fill="currentColor"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="currentColor"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="currentColor"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        Continue with Google
      </button>

      <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
        By continuing you agree to the WIZZ community guidelines and privacy policy.
      </p>
    </div>
  );
}
