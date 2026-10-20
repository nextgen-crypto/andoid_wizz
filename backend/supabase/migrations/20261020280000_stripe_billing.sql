-- Stripe subscriptions (2026-10-20)
--
-- Premium is moving from the labelled free preview to real Stripe Checkout.
-- The webhook (Supabase Edge Function `stripe-webhook`) is the only writer of
-- `premium_until`/`verified` in live mode; these columns let it map a Stripe
-- event back to the account:
--
--   stripe_customer_id             cus_…  -> profiles.id
--   stripe_subscription_id         sub_…  for cancel/resume without a lookup
--   premium_cancel_at_period_end          cancel requested, access runs to
--                                         premium_until

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists premium_cancel_at_period_end boolean not null default false;

-- Stripe customer ids are unique across accounts: two profiles claiming the
-- same customer would both follow the same webhook.
create unique index if not exists profiles_stripe_customer_key
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- The privilege trigger must freeze the new columns too. RLS lets a user
-- update their own row, so without this a client-side PATCH could point
-- stripe_customer_id at somebody else's active subscription and inherit
-- their renewed period from the next webhook delivery.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  new.verified := old.verified;
  new.premium_until := old.premium_until;
  new.stripe_customer_id := old.stripe_customer_id;
  new.stripe_subscription_id := old.stripe_subscription_id;
  new.premium_cancel_at_period_end := old.premium_cancel_at_period_end;
  return new;
end;
$$;
