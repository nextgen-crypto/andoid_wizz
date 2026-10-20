/**
 * Pure helpers for the email verification-code sign-in.
 *
 * Supabase Auth issues numeric codes (6–8 digits depending on project config)
 * through signInWithOtp() and verifies them with verifyOtp({ type: "email" }).
 * Everything here is deliberately framework-free so the rules can be tested
 * exhaustively without mounting React or touching the network.
 */

/** Codes are digits only; users paste with spaces/dashes from mail clients. */
export function normalizeCode(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

/** GoTrue accepts 6–8 digit codes; shorter is always a typo. */
export function isValidCode(code: string): boolean {
  return /^[0-9]{6,8}$/.test(code);
}

/** Supabase rate-limits OTP sends (~1/min); we mirror that client-side so the
 *  user isn't told "too many requests" by the server after tapping resend. */
export const RESEND_COOLDOWN_MS = 60_000;

export function resendAvailable(sentAt: number | null, now: number): boolean {
  if (sentAt === null) return true;
  return now - sentAt >= RESEND_COOLDOWN_MS;
}

/** Seconds until the next resend is allowed (0 when it already is). */
export function resendSecondsLeft(sentAt: number | null, now: number): number {
  if (sentAt === null) return 0;
  // Clamp to the window: a clock that jumps backwards must never extend the
  // wait past RESEND_COOLDOWN_MS, or a skewed device could lock the user out.
  const elapsed = Math.max(0, now - sentAt);
  return Math.max(0, Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000));
}

/** GoTrue's raw auth errors, in the words users actually hit them. */
export function readableCodeError(err: unknown): string {
  // AuthError extends Error, but bridge/serialized failures can arrive as a
  // bare { message } object — unwrap either shape.
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err ?? "");
  if (!raw) return "That didn't work. Try again.";
  if (/token has expired or is invalid/i.test(raw)) {
    return "That code didn't work — it may have expired. Request a new one.";
  }
  if (/email not confirmed/i.test(raw)) {
    return "Confirm your email first, then enter the code from that message.";
  }
  if (/rate limit|too many requests/i.test(raw)) {
    return "Too many attempts — wait a minute, then request a new code.";
  }
  if (/user not found/i.test(raw)) {
    return "No account for that email yet — switch to Sign up, or check the address.";
  }
  // Signin mode sends shouldCreateUser:false, so a brand-new address gets this.
  if (/signups? not allowed/i.test(raw)) {
    return "No account for that email yet — switch to Sign up, or check the address.";
  }
  // Relay refuses undeliverable domains (null-MX, typos).
  if (/email address .* is invalid/i.test(raw)) {
    return "That address can't receive mail — check it for typos.";
  }
  return raw;
}

/** Guards the send step: an empty/invalid address never reaches the network. */
export function normalizeEmailForOtp(email: string): string | null {
  const cleaned = email.trim().toLowerCase();
  if (!cleaned) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return null;
  return cleaned;
}
