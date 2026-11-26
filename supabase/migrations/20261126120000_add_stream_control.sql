-- Stream control: permitted mods switch the streamer's Streamlabs scenes and
-- show/hide sources in them.
--
-- Streamlabs only accepts remote control from the streamer's own PC
-- (127.0.0.1:59650), so broadside never talks to it. A relay page the streamer
-- keeps open on that PC holds the Streamlabs token (in that browser only, never
-- sent here), reports the scene list up, and runs queued commands. Its code
-- knows two write actions — switch scene, set visibility — which is what
-- guarantees nobody can delete anything through this, whatever reaches the
-- commands table.
--
-- stream_control_enabled is the super-admin module switch (lib/admin.ts
-- CHANNEL_MODULES). Off by default.
alter table public.streams add column if not exists stream_control_enabled boolean default false;

-- Per-mod grants, set by the streamer like can_curate. The streamer always has
-- both while the module is on.
alter table public.moderators add column if not exists can_switch_scenes boolean not null default false;
alter table public.moderators add column if not exists can_toggle_sources boolean not null default false;

-- What the relay last saw in Streamlabs: one row per stream, replaced whole on
-- every change. snapshot is lib/stream-control.ts ControlSnapshot, validated
-- before it's stored.
create table if not exists public.stream_control_state (
  stream_id uuid primary key references public.streams(id) on delete cascade,
  snapshot jsonb not null,
  -- Whether the relay currently has a working Streamlabs connection. The relay
  -- tab can be open with Streamlabs closed; mods need to tell those apart.
  streamlabs_connected boolean not null default false,
  updated_at timestamptz not null default now(),
  -- Heartbeat: a relay that stops checking in is treated as offline.
  relay_seen_at timestamptz not null default now()
);

-- Queued actions, kept afterwards as the record of who did what.
-- pending → running (claimed by the relay) → done | failed; pending rows older
-- than a few seconds become expired instead of running, so a relay that comes
-- back after a gap doesn't replay stale toggles mid-show.
create table if not exists public.stream_control_commands (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  kind text not null check (kind in ('switch_scene', 'set_visibility')),
  args jsonb not null,
  actor_account_id text not null,
  actor_login text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'expired')),
  error text check (error is null or char_length(error) <= 500),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists stream_control_commands_stream_idx
  on public.stream_control_commands(stream_id, created_at desc);
-- The relay's claim query.
create index if not exists stream_control_commands_pending_idx
  on public.stream_control_commands(stream_id, created_at)
  where status = 'pending';
-- Retention sweep (app/api/cron/cleanup) runs across every stream.
create index if not exists stream_control_commands_created_idx
  on public.stream_control_commands(created_at);

-- Service-role only, like every other table here.
alter table public.stream_control_state enable row level security;
alter table public.stream_control_commands enable row level security;
