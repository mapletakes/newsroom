-- Suspicious-user log: keeps messages from users Twitch or a mod has flagged,
-- which ordinary chat log sites never see. Twitch offers no history endpoint,
-- so anything not captured as it arrives is gone; suspicious_log_status exists
-- so the log can say plainly when capture has stopped.
--
-- suspicious_log_enabled is the super-admin module switch (lib/admin.ts
-- CHANNEL_MODULES). Off by default: capture needs the
-- moderator:read:suspicious_users scope, which accounts connected before this
-- shipped don't have until they reconnect.
alter table public.streams add column if not exists suspicious_log_enabled boolean default false;
alter table public.streams add column if not exists suspicious_log_status text not null default 'off'
  check (suspicious_log_status in ('off', 'active', 'needs_reconnect', 'stopped'));
alter table public.streams add column if not exists suspicious_log_status_at timestamptz;

-- low_trust_status and detection_types are deliberately unconstrained: they
-- are Twitch's vocabulary, and a value added on their side must still be
-- recorded rather than rejected and lost for good.
create table if not exists public.suspicious_messages (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  twitch_message_id text not null,
  chatter_user_id text not null,
  chatter_login text not null,
  chatter_name text not null,
  message_text text not null,
  fragments jsonb not null default '[]'::jsonb,
  low_trust_status text not null,
  detection_types text[] not null default '{}',
  ban_evasion_evaluation text,
  shared_ban_channel_ids text[] not null default '{}',
  -- When Twitch sent the notification: the event has no sent-time of its own.
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Twitch retries webhook deliveries; one chat message is one row.
  unique (stream_id, twitch_message_id)
);

create index if not exists suspicious_messages_stream_sent_idx
  on public.suspicious_messages(stream_id, sent_at desc);
create index if not exists suspicious_messages_chatter_idx
  on public.suspicious_messages(stream_id, chatter_user_id, sent_at desc);
-- Retention sweep (app/api/cron/cleanup) runs across every stream.
create index if not exists suspicious_messages_sent_idx
  on public.suspicious_messages(sent_at);

-- Who changed a user's status and when, as context beside their messages.
create table if not exists public.suspicious_status_changes (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  -- The delivery id: a status change has no id of its own to dedup retries on.
  twitch_event_id text not null,
  chatter_user_id text not null,
  chatter_login text not null,
  chatter_name text not null,
  moderator_user_id text,
  moderator_login text,
  low_trust_status text not null,
  changed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (stream_id, twitch_event_id)
);

create index if not exists suspicious_status_changes_chatter_idx
  on public.suspicious_status_changes(stream_id, chatter_user_id, changed_at desc);
create index if not exists suspicious_status_changes_changed_idx
  on public.suspicious_status_changes(changed_at);

-- Service-role only, like every other table here. Access is enforced in the
-- API routes, never by exposing these tables to the browser.
alter table public.suspicious_messages enable row level security;
alter table public.suspicious_status_changes enable row level security;
