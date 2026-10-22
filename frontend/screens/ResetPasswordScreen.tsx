import { useNavigate } from "@tanstack/react-router";
import { PasswordReset } from "@/frontend/components/auth/PasswordReset";
import { useSession } from "@/frontend/hooks/useSession";

/**
 * Landing page for the reset link in the recovery email. The link arrives as
 * `?code=`, which supabase-js's detectSessionInUrl exchanges for a recovery
 * session on load; PasswordReset sees that session and flips straight to the
 * new-password step. If the link was already used or expired there is no
 * session — the hint says so and the same panel lets the user request a
 * fresh code without leaving the page.
 */
export function ResetPasswordScreen() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const codeInUrl =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("code");
  const expired = !loading && !session && codeInUrl;

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col bg-background px-5 pb-10 pt-6 sm:px-8 sm:pt-8 md:justify-center md:border-x md:border-border">
      <span className="text-3xl font-extrabold tracking-tight text-title">WIZZ</span>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
        Reset your password
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {expired
          ? "That link has expired or was already used — request a fresh code below."
          : "Choose a new password to finish recovering your account."}
      </p>

      <PasswordReset
        hint={expired ? "Send yourself a new code below." : undefined}
        onBack={() => void navigate({ to: session ? "/" : "/auth", replace: true })}
      />
    </div>
  );
}
