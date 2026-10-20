-- Verified is a paid perk: `activatePremium` / `cancelPremium` (service role)
-- keep profiles.verified in step with profiles.premium_until, and the read
-- path self-heals any natural expiry. Free accounts can no longer request the
-- badge, so the admin review queue is retired along with its RLS policies,
-- pending-row index and foreign key (all owned by the table).
drop table if exists public.verification_requests;
