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

-- Chat command that replies with what's currently on the deck (the same
-- "Watching: <title> <url>" payload as the deck's manual "Post to chat"
-- button), for viewers who can't see pinned/announced messages. Blank
-- disables it. The cooldown timestamp guards against a burst of the command
-- spamming chat the moment something starts trending — Vercel functions
-- don't persist state between invocations, so this has to live in the DB.
alter table public.streams add column if not exists video_command text default '!video';
alter table public.streams add column if not exists video_command_last_sent_at timestamptz;

-- Per-stream theming. Two columns rather than one because they answer to
-- different masters: app_theme is a DEFAULT that any mod can override locally
-- (the deck has to stay legible for whoever is triaging at 2am), while
-- overlay_theme is absolute — it's matching a stream's branding on air, with
-- nobody around to adjust it. Stored as jsonb rather than a column per slot
-- so the shape can grow without a migration each time; every read goes
-- through sanitizeAppTheme/sanitizeOverlayTheme in lib/theme.ts, which drops
-- anything unrecognised, so an older or newer shape degrades to defaults
-- instead of breaking the page.
alter table public.streams add column if not exists app_theme jsonb;
alter table public.streams add column if not exists overlay_theme jsonb;

-- Moderators on a stream
create table if not exists public.moderators (
  stream_id uuid references public.streams(id) on delete cascade,
  twitch_user_id text not null,
  twitch_login text not null,
  added_at timestamptz default now(),
  -- if true, this mod may curate the streamer deck (organize, not play)
  can_curate boolean default false,
  -- if true, this mod may also set/change which approved item is on air —
  -- for correcting a streamer's misclick or forgotten advance, not for
  -- running the show. Meaningless without can_curate (a mod without it can
  -- never reach the deck at all — see app/deck/page.tsx), so the UI only
  -- ever offers this alongside can_curate and clears it when can_curate is
  -- revoked, but it's enforced independently server-side regardless.
  can_set_now_playing boolean default false,
  -- Availability the mod sets for themselves, so a growing mod team can see
  -- who's actually watching chat right now. Deliberately NOT presence: there
  -- is no heartbeat and nothing is inferred from being logged in. It's a
  -- self-reported claim, and status_updated_at is what keeps it honest —
  -- every surface renders the age beside the colour, so a "green" set four
  -- hours ago reads as four hours old rather than as green.
  --   null   -- never set; renders neutral
  --   green  -- here and attentive
  --   yellow -- here, but split attention
  --   red    -- not available
  status text,
  status_note text,
  status_updated_at timestamptz,
  -- Set from the stripped-down /mod-status page (a quick mobile check-in
  -- surface, no roster chrome), so the board can show a small mobile badge
  -- next to the name instead of guessing from user-agent. Reflects how the
  -- CURRENT status was set, not "has ever used mobile" — every save
  -- overwrites it, same as status_updated_at.
  status_via_mobile boolean default false,
  primary key (stream_id, twitch_user_id)
);
-- For databases created before can_set_now_playing existed.
alter table public.moderators add column if not exists can_set_now_playing boolean default false;
-- For databases created before mod status existed.
alter table public.moderators add column if not exists status text;
alter table public.moderators add column if not exists status_note text;
alter table public.moderators add column if not exists status_updated_at timestamptz;
alter table public.moderators add column if not exists status_via_mobile boolean default false;

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
  -- Audience-facing trigger warning, written by the streamer or a mod.
  -- Deliberately separate from both content_warning (AI-guessed, internal
  -- triage) and mod_notes (internal production notes): this text is published
  -- — it LEADS the !video / "Post to chat" message, ahead of the title and
  -- url so it survives Twitch's pinned-message preview, and is shown on the
  -- on-air overlay — so it's the one note field that must be authored
  -- knowing viewers will read it verbatim.
  trigger_warning text,
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
-- For databases created before trigger_warning existed.
alter table public.submissions add column if not exists trigger_warning text;

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

-- Lists ("the shelf"): durable, named collections of content, independent
-- of the daily run of show. Unlike segments (which organize the LIVE deck
-- and get cleared/reused constantly), a list is meant to persist across
-- sessions and be reusable as pre-built show material — and, later, shared
-- streamer-to-streamer via share_token.
create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid references public.streams(id) on delete cascade,
  name text not null default 'New shelf',
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

-- List segments: named groupings within a shelf, mirroring the deck's
-- `segments` table but kept entirely separate — a shelf is meant to persist
-- and be reused (e.g. a recurring weekly-format shelf you rebuild from each
-- week), while deck segments get cleared/reused constantly. "Sending a
-- rundown to the deck" always creates FRESH deck segments from these, it
-- never reparents them, so the shelf's own structure is never consumed.
create table if not exists public.list_segments (
  id uuid primary key default gen_random_uuid(),
  list_id uuid references public.lists(id) on delete cascade,
  name text not null default 'New segment',
  position int default 0,
  created_at timestamptz default now()
);
create index if not exists list_segments_list_idx on public.list_segments(list_id, position);

alter table public.list_items add column if not exists segment_id uuid references public.list_segments(id) on delete set null;

-- Position of the shelf's "ungrouped" bucket among its list_segments, same
-- convention as streams.ungrouped_position for the deck.
alter table public.lists add column if not exists ungrouped_position int default 0;

-- A curator's own prep note, distinct from mod_notes (which is
-- editorial/risk-flagging territory). Populated by copying a shelf item's
-- `note` over when it's sent to the deck; the deck seeds its takeaway box
-- from this so a note written during research reappears on air instead of
-- being retyped.
alter table public.submissions add column if not exists prep_note text;

-- Audience Q&A. Gated behind a super-admin flag (questions_enabled) rather
-- than being on for everyone by default — unlike a submitted link, which a
-- mod always sees before it's played, a question is free text that can reach
-- the streamer's eyeline live during an interview, so it's opt-in per account
-- rather than opt-out.
--
-- question_command follows video_command's convention: blank disables it even
-- when the account-level flag is on, so a streamer can turn the chat command
-- off without losing the feature or waiting on an admin.
alter table public.streams add column if not exists questions_enabled boolean default false;
alter table public.streams add column if not exists question_command text default '!question';

-- The streamer's own on/off switch, separate from both of the above:
-- questions_enabled is the super admin deciding the ACCOUNT may use this at
-- all; question_command is what triggers it. questions_open is the streamer
-- deciding whether they're currently taking questions — a "pause" they can
-- flip without clearing their configured command (which blanking
-- question_command would do) and without an admin's involvement. Defaults to
-- true so an account an admin just enabled works immediately.
alter table public.streams add column if not exists questions_open boolean default true;

-- Mod availability board (see moderators.status). Super-admin gated and off
-- by default, same as questions_enabled — it's only worth anything to
-- channels with a mod team big enough that "who's actually watching right
-- now" is a real question, and it puts mods' names and availability on a
-- shared screen, so it's opt-in per account rather than on for everyone.
alter table public.streams add column if not exists mod_status_enabled boolean default false;

-- Status flow mirrors submissions (pending -> approved -> played) with one
-- addition: rejected can still be un-rejected back to pending, same as the
-- mod queue, so a mod's misclick isn't permanent.
--   pending   -- just landed from chat, not yet triaged
--   approved  -- cleared by a mod; visible in the streamer's deck panel
--   answered  -- the streamer marked it handled
--   rejected  -- a mod declined it (spam, abuse, off-topic)
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid references public.streams(id) on delete cascade,
  text text not null,
  asker_login text,
  asker_is_sub boolean default false,
  asker_is_mod boolean default false,
  asker_is_vip boolean default false,
  status text not null default 'pending',
  position int,
  created_at timestamptz default now(),
  approved_at timestamptz,
  answered_at timestamptz
);
create index if not exists questions_stream_status_idx on public.questions(stream_id, status, position);
create index if not exists questions_stream_created_idx on public.questions(stream_id, created_at desc);

-- The question currently taking over the on-air overlay, if any. Null is the
-- normal state: the overlay shows now_playing_id as it always has, and
-- setting this swaps the card for the question until it's cleared again.
--
-- Lives on the stream rather than as a flag on the question row, for the same
-- reason now_playing_id does: "what is on screen right now" is a property of
-- the broadcast, and exactly one thing can hold it. A boolean per question
-- would let two rows both claim to be live and need reconciling on every
-- write.
--
-- Declared down here rather than beside the other streams columns purely
-- because the FK needs public.questions to exist first; on a fresh database
-- the statements run in file order.
--
-- `on delete set null` matters more than it looks: a question deleted out
-- from under a live overlay would otherwise leave the stream pointing at a
-- row that no longer exists, and the overlay is the one surface nobody has
-- open in a tab to notice when it breaks.
alter table public.streams
  add column if not exists overlay_question_id uuid
  references public.questions(id) on delete set null;

-- Per-PERSON appearance, as opposed to streams.app_theme, which is a
-- channel's brand and is shared by everyone who looks at it.
--
-- Exists because a mod has no channel of their own to carry a preference on.
-- Their only durable row is in `moderators`, which is per stream — so a mod
-- who works three channels would have had to set their theme three times, and
-- the header's preset picker (next-themes) only ever lived in localStorage,
-- meaning it reset on every new browser or device.
--
-- Keyed on twitch_user_id and NOT scoped to a stream, deliberately: this
-- follows the person, not the channel. Nothing here can affect what anyone
-- else sees, which is what makes it safe to let a mod edit while
-- streams.app_theme stays streamer-only.
--
-- No FK: a Twitch user exists independently of whether they currently moderate
-- anywhere, and a preference shouldn't evaporate because a streamer removed
-- them from one channel's mod list.
create table if not exists public.user_prefs (
  twitch_user_id text primary key,
  app_theme jsonb,
  updated_at timestamptz default now()
);

-- Chat raffles. Super-admin gated (raffle_enabled) for the same reason
-- questions is: it's a live audience-facing mechanic, opt-in per account
-- rather than on for everyone by default.
--
-- No settings-tab configuration at all, unlike question_command/
-- submit_command — the entry command, duration, and winner count are all set
-- at the moment a raffle is started (see command below) and only mean
-- anything for that one raffle's lifetime, so there is nothing durable to
-- store a default for.
--
-- One raffle "current" per stream is enforced in the API (reject starting a
-- second one while another is 'open'), not by a DB constraint — same
-- judgment call as questions' status flow: the row shape doesn't prevent it,
-- the write path does.
create table if not exists public.raffles (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid references public.streams(id) on delete cascade,
  -- Snapshot of the command chat had to type, not a reference to any
  -- settings value — there isn't one. Kept on the row (rather than only
  -- ever living in memory) so a raffle started, then revisited after a
  -- refresh, still knows what it's listening for.
  command text not null,
  winner_count int not null default 1,
  status text not null default 'open', -- 'open' | 'closed'
  opened_at timestamptz default now(),
  -- Required, not nullable: a raffle is always started with a duration (the
  -- form doesn't offer "no timer"). closes_at is what the lazy-close check
  -- (see lib/raffle.ts) compares against — there is no scheduled job ending
  -- a raffle on the tick; whichever request touches it first after this
  -- time closes it, same pattern as the 12h mod-status reset.
  closes_at timestamptz not null,
  closed_at timestamptz,
  -- Separate from closed_at rather than inferred from it: closing (which can
  -- happen automatically, unattended) and announcing the winners to chat
  -- (always a deliberate click) are different moments the operator may want
  -- apart — reading names out loud before posting them, say.
  winners_announced_at timestamptz,
  started_by_login text
);
create index if not exists raffles_stream_status_idx on public.raffles(stream_id, status);

create table if not exists public.raffle_entries (
  id uuid primary key default gen_random_uuid(),
  raffle_id uuid references public.raffles(id) on delete cascade,
  -- Denormalized alongside raffle_id rather than joined through it: every
  -- query here is already scoped to "this stream's session", and this keeps
  -- that scoping direct instead of routing through raffles on every read.
  stream_id uuid references public.streams(id) on delete cascade,
  chatter_login text not null,
  entered_at timestamptz default now(),
  is_winner boolean not null default false,
  -- THE mechanism behind "a unique list of chatters" — a second !enter from
  -- the same login is a no-op insert (ON CONFLICT DO NOTHING), not something
  -- the application code has to notice and reject.
  unique (raffle_id, chatter_login)
);
create index if not exists raffle_entries_raffle_idx on public.raffle_entries(raffle_id);

alter table public.streams add column if not exists raffle_enabled boolean default false;

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
alter table public.list_segments enable row level security;
alter table public.questions enable row level security;
alter table public.raffles enable row level security;
alter table public.raffle_entries enable row level security;

-- Public read of streams (for the deck/mod views via service-role queries)
-- We do NOT grant anon any access; the API routes use the service role.
-- If you want client-side reads later, add policies here.
