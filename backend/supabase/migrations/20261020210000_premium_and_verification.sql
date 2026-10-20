-- WIZZ Premium + verified requests (2026-10-20)
--
-- Turns the localStorage-only "subscriptions" toggles into real account
-- state: premium_until drives the badge and the settings row, and
-- verification_requests is the queue admins review from the console.

-- 1) Premium membership expiry on the profile.
alter table public.profiles
  add column if not exists premium_until timestamptz;

-- 2) Verification requests: users ask, admins approve from the console.
create table if not exists public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewer_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- One live request per user; re-requesting after a rejection is allowed.
create unique index if not exists verification_requests_pending_key
  on public.verification_requests (user_id)
  where status = 'pending';

alter table public.verification_requests enable row level security;

create policy "own verification requests are readable"
  on public.verification_requests for select
  using (auth.uid() = user_id);

create policy "signed-in users may request verification"
  on public.verification_requests for insert
  with check (auth.uid() = user_id and status = 'pending');

-- Review (approve/reject) happens through the service-role client inside
-- admin server functions; there are intentionally no user-facing
-- update/delete policies.

-- 3) verified and premium_until are server-granted privileges. RLS lets a
-- user update their own profile row, so without this trigger an edit from
-- the app (or a direct PostgREST PATCH) could grant both to itself.
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
  return new;
end;
$$;

drop trigger if exists protect_profile_privileges on public.profiles;
create trigger protect_profile_privileges
  before update on public.profiles
  for each row
  execute function public.protect_profile_privileges();
