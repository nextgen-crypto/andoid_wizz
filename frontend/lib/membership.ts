/**
 * Client-side WIZZ Premium checks for badge rendering.
 *
 * The authoritative state lives on `profiles.premium_until` (written only by
 * server functions — a trigger blocks client updates), so this helper just
 * answers "is that expiry still in the future" for display purposes. An
 * active subscription is what earns the verified badge — see
 * subscriptions.functions.ts for the paid-only rule.
 */
export function isPremiumActive(premiumUntil: string | null | undefined): boolean {
  if (!premiumUntil) return false;
  const expires = Date.parse(premiumUntil);
  return Number.isFinite(expires) && expires > Date.now();
}
