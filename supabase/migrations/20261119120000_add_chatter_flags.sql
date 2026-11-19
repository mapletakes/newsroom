-- Network chatter flags: a channel with the suspicious log turned on can flag a
-- chatter as a problem, so other channels in the network can review them and
-- decide whether to ban them too. This migration covers flagging; subscribing
-- to other channels' flags comes later.
--
-- Evidence is the channel's own suspicious-log entries, linked rather than
-- copied (the same choice as suspicious_shares): deleting a message, or the
-- log's one-year retention sweep, removes it from the flag too. A chatter who
-- was banned before Twitch or a mod ever marked them suspicious has no log
-- entries, so a flag without messages must carry written context instead. That
-- rule lives in the API, where the error can say what's missing.
--
-- created_by_* is who on the channel's team made the flag. Other channels see
-- only the reporting channel, never this; it's kept for the channel itself and
-- for admin review.
create table if not exists public.chatter_flags (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  chatter_user_id text not null,
  chatter_login text not null,
  chatter_name text not null,
  category text not null
    check (category in ('harassment', 'hate', 'spam', 'ban_evasion', 'doxxing', 'other')),
  context text not null default '' check (char_length(context) <= 4000),
  created_by_id text not null,
  created_by_login text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  -- Set when the channel takes its flag back. Kept so the channel can see it.
  withdrawn_at timestamptz,
  -- Set when an admin takes a flag down. Hidden from everyone but admins.
  removed_at timestamptz,
  -- A flag lasts as long as the log entries it points at could.
  expires_at timestamptz not null
);

-- One live flag per chatter per channel: a second mod adds to it instead.
create unique index if not exists chatter_flags_one_live_idx
  on public.chatter_flags(stream_id, chatter_user_id)
  where withdrawn_at is null and removed_at is null;
create index if not exists chatter_flags_stream_idx
  on public.chatter_flags(stream_id, created_at desc);
-- The network view (later) reads every channel's flags for one chatter.
create index if not exists chatter_flags_chatter_idx
  on public.chatter_flags(chatter_user_id);
-- The cleanup cron deletes expired flags across every stream.
create index if not exists chatter_flags_expires_idx
  on public.chatter_flags(expires_at);

create table if not exists public.chatter_flag_messages (
  flag_id uuid not null references public.chatter_flags(id) on delete cascade,
  message_id uuid not null references public.suspicious_messages(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (flag_id, message_id)
);

create index if not exists chatter_flag_messages_message_idx
  on public.chatter_flag_messages(message_id);

-- Service-role only, like every other table here.
alter table public.chatter_flags enable row level security;
alter table public.chatter_flag_messages enable row level security;
