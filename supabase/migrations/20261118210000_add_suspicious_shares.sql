-- Share links for the suspicious-user log. Each row is one unlisted, expiring,
-- revocable link, served publicly at /sl/<token> through our own page (the
-- token is the only credential, so the table is service-role only).
--
-- A link points at log entries rather than holding copies of them: deleting a
-- message, or the one-year retention sweep, removes it from every link too.
--
-- kind 'messages': exactly the entries in message_ids.
-- kind 'chatter':  everything that user said in this channel up to created_at.
--                  Cut off there so a link shared as evidence doesn't quietly
--                  grow as the user keeps chatting.
create table if not exists public.suspicious_shares (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  token text not null unique,
  kind text not null check (kind in ('messages', 'chatter')),
  message_ids uuid[] not null default '{}',
  chatter_user_id text,
  -- The page's heading: the chatter's name, or a generic one for a mixed pick.
  label text not null,
  created_by_id text not null,
  created_by_login text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (
    (kind = 'messages' and cardinality(message_ids) > 0)
    or (kind = 'chatter' and chatter_user_id is not null)
  )
);

create index if not exists suspicious_shares_stream_idx
  on public.suspicious_shares(stream_id, created_at desc);
-- The cleanup cron deletes long-expired links across every stream.
create index if not exists suspicious_shares_expires_idx
  on public.suspicious_shares(expires_at);

alter table public.suspicious_shares enable row level security;
