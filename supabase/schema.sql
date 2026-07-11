-- ============================================================
-- newsroom schema
-- Run this in the Supabase SQL editor.
-- ============================================================

-- Stream sessions: one row per streamer's live session
create table if not exists public.streams (
  id uuid primary key default gen_random_uuid(),
  twitch_user_id text unique not null,
  twitch_login text not null,
  display_name text,
  created_at timestamptz default now(),
  -- Settings
  submit_command text default '!submit',
  allow_anyone boolean default true, -- if false, only subs/vips/mods
  allow_duplicates boolean default false, -- if true, same URL can be submitted more than once
  auto_summarize boolean default true,
  ignored_users text[] default '{}'::text[], -- usernames whose links are silently dropped
  preferred_sources text[] default '{}'::text[], -- domains prioritised in related coverage search
  ungrouped_position int default 0, -- order of the "ungrouped" block among deck segments
  now_playing_id uuid, -- submission the streamer is currently showing on the deck
  notes_exported_at timestamptz, -- marks the last show-notes export boundary
  -- Streamer OAuth tokens (sensitive; service-role access only) used to post
  -- "now watching" messages to chat on the streamer's behalf.
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  -- Personal token for quick-adding links from a bookmarklet / extension.
  add_token text,
  -- Admin access gate. false = blocked / pending approval.
  approved boolean default true
);

-- Moderators on a stream
create table if not exists public.moderators (
  stream_id uuid references public.streams(id) on delete cascade,
  twitch_user_id text not null,
  twitch_login text not null,
  added_at timestamptz default now(),
  -- if true, this mod may curate the streamer deck (organize, not play)
  can_curate boolean default false,
  primary key (stream_id, twitch_user_id)
);

-- Segments: named, ordered groups for organising the streamer deck "up next"
create table if not exists public.segments (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid references public.streams(id) on delete cascade,
  name text not null default 'New segment',
  position int default 0,
  collapsed boolean default false,
  created_at timestamptz default now()
);
create index if not exists segments_stream_idx on public.segments(stream_id, position);

-- Quick links: a streamer's personal "on-hand" links (fossabot, fundraisers,
-- etc.) shown in a popout drawer. Entirely separate from the deck/submissions.
create table if not exists public.quick_links (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid references public.streams(id) on delete cascade,
  label text not null,
  url text not null,
  position int default 0,
  created_at timestamptz default now()
);
create index if not exists quick_links_stream_idx on public.quick_links(stream_id, position);

-- Submissions: every link harvested from chat
-- Status flow:  pending -> approved -> played | pending -> rejected
create type submission_status as enum ('pending', 'approved', 'rejected', 'played');
create type media_kind as enum ('article', 'youtube', 'youtube_short', 'youtube_playlist', 'twitch_clip', 'twitch_vod', 'twitter', 'tiktok', 'unknown');

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid references public.streams(id) on delete cascade,
  url text not null,
  normalized_url text not null,
  kind media_kind default 'unknown',
  status submission_status default 'pending',
  -- Preview metadata
  title text,
  description text,
  thumbnail_url text,
  publisher text,
  author text,
  duration_seconds int,
  published_at timestamptz,
  -- AI-generated
  summary text,
  credibility_tag text, -- 'mainstream' | 'partisan-left' | 'partisan-right' | 'tabloid' | 'blog' | 'social' | null
  topics text[],
  dmca_risk text, -- 'low' | 'medium' | 'high' | null
  content_warning text, -- short reason if title/description/AI flags graphic material; null otherwise
  -- Submission context
  submitter_login text,
  submitter_is_sub boolean default false,
  submitter_is_mod boolean default false,
  submitter_is_vip boolean default false,
  raw_message text,
  -- Related coverage (populated on approval)
  related_coverage jsonb,
  -- Wayback Machine snapshot URL (receipts for deleted/edited content)
  archive_url text,
  -- Mod actions
  mod_notes text,
  position int,
  segment_id uuid references public.segments(id) on delete set null,
  -- Timing
  created_at timestamptz default now(),
  approved_at timestamptz,
  played_at timestamptz,
  duration_on_screen_s int
);

create index if not exists submissions_stream_status_idx
  on public.submissions(stream_id, status, position);
create index if not exists submissions_stream_created_idx
  on public.submissions(stream_id, created_at desc);
create index if not exists submissions_stream_url_idx
  on public.submissions(stream_id, normalized_url);

-- For databases created before content_warning existed.
alter table public.submissions add column if not exists content_warning text;

-- Show notes: persisted artifacts of what was reacted to
create table if not exists public.show_notes (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid references public.streams(id) on delete cascade,
  -- Keep the note even if the submission is later cleared/deleted.
  submission_id uuid references public.submissions(id) on delete set null,
  played_at timestamptz not null,
  stream_started_at timestamptz,
  timestamp_offset_s int, -- seconds into the stream when played
  title text,
  url text,
  summary text,
  archive_url text, -- Wayback snapshot, copied at play time
  takeaway text, -- optional streamer's note
  created_at timestamptz default now()
);

create index if not exists show_notes_stream_idx
  on public.show_notes(stream_id, played_at);

-- Processed EventSub messages: idempotency guard so each Twitch chat message is
-- ingested exactly once, even if Twitch retries the webhook (slow handler) or a
-- duplicate subscription delivers it again. Keyed on the chat message id.
create table if not exists public.processed_events (
  id text primary key,
  created_at timestamptz default now()
);
create index if not exists processed_events_created_idx on public.processed_events(created_at);

-- Usage events: one row per metered/paid operation (AI enrichment, coverage
-- search, extraction). Used to understand per-stream cost and volume — purely
-- observational, written best-effort and never on the critical path.
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  -- Keep cost history even if the stream is later deleted.
  stream_id uuid references public.streams(id) on delete set null,
  kind text not null,             -- 'ai_enrich' | 'coverage_search' | 'extract'
  units int not null default 1,   -- billable requests, or 1 per processed item
  meta jsonb default '{}'::jsonb, -- model, token counts, item kind, etc.
  created_at timestamptz default now()
);
create index if not exists usage_events_stream_idx on public.usage_events(stream_id, created_at);
create index if not exists usage_events_kind_idx on public.usage_events(kind, created_at);

-- Lists ("clip files"): durable, named collections of content, independent
-- of the daily run of show. Unlike segments (which organize the LIVE deck
-- and get cleared/reused constantly), a list is meant to persist across
-- sessions and be reusable as pre-built show material — and, later, shared
-- streamer-to-streamer via share_token.
create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid references public.streams(id) on delete cascade,
  name text not null default 'New clip file',
  position int default 0,
  -- Set when the streamer makes this list shareable via a read-only link.
  share_token text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists lists_stream_idx on public.lists(stream_id, position);
create index if not exists lists_share_token_idx on public.lists(share_token);

-- Items in a list. Metadata is SNAPSHOTTED here (not a foreign key into
-- submissions): submissions get bulk-deleted by routine queue cleanup
-- ("Clear played/rejected"), but a durable list can't have its items vanish
-- because someone did end-of-day housekeeping. This also means an imported
-- (shared-from-another-streamer) item works identically to a locally-added
-- one — there's no cross-stream reference to keep valid.
create table if not exists public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid references public.lists(id) on delete cascade,
  url text not null,
  normalized_url text not null,
  kind media_kind default 'unknown',
  title text,
  description text,
  thumbnail_url text,
  publisher text,
  author text,
  duration_seconds int,
  published_at timestamptz,
  summary text,
  credibility_tag text,
  topics text[],
  dmca_risk text,
  content_warning text,
  -- Curator's own note (distinct from the AI summary) — e.g. why this is on
  -- the list, or a starting point copied from a submission's mod_notes.
  note text,
  added_by text, -- twitch login of whoever added it, or "via @streamer" on import
  position int default 0,
  created_at timestamptz default now()
);
create index if not exists list_items_list_idx on public.list_items(list_id, position);
create index if not exists list_items_list_url_idx on public.list_items(list_id, normalized_url);

-- ============================================================
-- Row Level Security
-- ============================================================
-- For MVP we use the service role on the server for writes
-- and gate reads via signed session cookies. Enable RLS so
-- direct client access is locked down.

alter table public.streams enable row level security;
alter table public.moderators enable row level security;
alter table public.segments enable row level security;
alter table public.quick_links enable row level security;
alter table public.usage_events enable row level security;
alter table public.processed_events enable row level security;
alter table public.submissions enable row level security;
alter table public.show_notes enable row level security;
alter table public.lists enable row level security;
alter table public.list_items enable row level security;

-- Public read of streams (for the deck/mod views via service-role queries)
-- We do NOT grant anon any access; the API routes use the service role.
-- If you want client-side reads later, add policies here.
