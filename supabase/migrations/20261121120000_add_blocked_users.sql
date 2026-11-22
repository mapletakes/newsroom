-- People a super-admin has blocked from the whole app. A blocked Twitch account
-- can't sign in, and any session it already holds stops working within seconds
-- (lib/blocked-users.ts is checked on every request, cached for a few seconds).
--
-- Keyed by Twitch user id, not login: a login can be renamed or reused, the id
-- can't. Service-role only, like every other table here.
create table if not exists public.blocked_users (
  twitch_user_id text primary key,
  twitch_login text not null,
  reason text,
  blocked_by_login text not null,
  created_at timestamptz not null default now()
);

alter table public.blocked_users enable row level security;
