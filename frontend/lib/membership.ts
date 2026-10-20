/**
 * Client-side WIZZ Premium checks for badge rendering.
 *
 * The authoritative state lives on `profiles.premium_until` (written only by
 * server functions — a trigger blocks client updates), so this helper just
 * answers "is that expiry still in the future" for display purposes.
 */
export function isPremiumActive(premiumUntil: string | null | undefined): boolean {
  if (!premiumUntil) return false;
  const expires = Date.parse(premiumUntil);
  return Number.isFinite(expires) && expires > Date.now();
}

/** Amber supporter tint used by the premium badge across the app. */
export const PREMIUM_BADGE_CLASS = "text-amber-500";
