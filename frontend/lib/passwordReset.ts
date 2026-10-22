/**
 * Password-reset rules shared by the sign-in screen's recovery panel and the
 * /reset-password route, so both legs of the flow (6-digit code entered in
 * the app, or reset link opened from the email) enforce the same bar — and
 * so the rules are matrix-tested without rendering a form.
 */

/** Returns a user-facing problem, or null when the new password is acceptable. */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < 6) return "Use at least 6 characters.";
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}

/** Recovery codes are digits only — strip formatting as the user types. */
export function sanitizeRecoveryCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}
