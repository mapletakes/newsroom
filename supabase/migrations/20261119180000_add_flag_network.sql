-- Network chatter flags, part two: channels receiving each other's flags.
--
-- flag_network_subscribed is the streamer's own choice, not an admin module
-- switch: it decides what their whole mod team sees. It only means anything
-- while suspicious_log_enabled is on; the API checks both.
alter table public.streams add column if not exists flag_network_subscribed boolean not null default false;

-- What a receiving channel decided about a flagged chatter. One row per channel
-- per chatter, not per flag: the question a channel answers is "do we ban this
-- person", whichever channels raised it. A flag made or changed after
-- decided_at reads as new again, so a channel that dismissed someone still
-- hears about it when a second channel flags them.
create table if not exists public.chatter_flag_reviews (
  stream_id uuid not null references public.streams(id) on delete cascade,
  chatter_user_id text not null,
  decision text not null check (decision in ('banned', 'dismissed', 'watching')),
  decided_by_id text not null,
  decided_by_login text not null,
  decided_at timestamptz not null default now(),
  primary key (stream_id, chatter_user_id)
);

alter table public.chatter_flag_reviews enable row level security;

-- Admin takedowns. removed_at already exists; these say who and why, so a
-- channel asking about a missing flag can be given an answer.
alter table public.chatter_flags add column if not exists removed_by_login text;
alter table public.chatter_flags add column if not exists removed_reason text
  check (removed_reason is null or char_length(removed_reason) <= 500);

-- The network view reads every channel's live flags, newest first.
create index if not exists chatter_flags_live_idx
  on public.chatter_flags(created_at desc)
  where withdrawn_at is null and removed_at is null;
