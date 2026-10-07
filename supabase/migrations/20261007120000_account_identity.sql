-- Groundwork for accounts that don't have a Twitch identity (email sign-in).
--
-- Until now a Twitch login was the only way to have a `streams` row, so
-- twitch_user_id doubled as "the account id". These changes separate the two:
-- an account is identified by the session's accountId (the Twitch user id for
-- Twitch accounts, the auth user id for email ones) and the Twitch columns
-- become optional. Existing rows are unaffected.
--
-- DEPLOY ORDER: run this BEFORE the app code that reads user_prefs.account_id.

-- streams: Twitch identity becomes optional; add the non-Twitch identity.
alter table public.streams alter column twitch_user_id drop not null;
alter table public.streams alter column twitch_login drop not null;
alter table public.streams add column if not exists auth_user_id uuid unique; -- supabase auth.users.id
alter table public.streams add column if not exists email text;

-- user_prefs: re-key from twitch_user_id to account_id. For every existing row
-- the two are the same value (accountId == twitchUserId for Twitch accounts).
alter table public.user_prefs add column if not exists account_id text;
update public.user_prefs set account_id = twitch_user_id where account_id is null;
alter table public.user_prefs alter column account_id set not null;
alter table public.user_prefs drop constraint if exists user_prefs_pkey;
alter table public.user_prefs add primary key (account_id);
alter table public.user_prefs alter column twitch_user_id drop not null;
