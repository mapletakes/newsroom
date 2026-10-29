-- In-house page archiving (lib/archive-freeze.ts), replacing archive.today.
-- Each row is one frozen, self-contained HTML snapshot stored in the private
-- `archives` Storage bucket and served publicly at /a/<id> through our own
-- route, which adds the sandboxing CSP (Storage can't set response headers).
--
-- submission_id is ON DELETE SET NULL rather than CASCADE: deleting the row
-- wouldn't delete the Storage object, so orphans are left for the daily
-- cleanup cron, which removes the object and then the row.
create table if not exists public.archives (
  id text primary key, -- short random slug, used in the public /a/<id> URL
  submission_id uuid references public.submissions(id) on delete set null,
  stream_id uuid,
  url text not null,       -- the URL that was asked for
  final_url text,          -- after redirects
  title text,
  method text not null default 'server' check (method in ('server', 'extension')),
  storage_path text not null,
  bytes int,
  created_at timestamptz not null default now()
);

create index if not exists archives_submission_idx on public.archives(submission_id);

-- Service-role only, like every other table here: the public /a/<id> route
-- reads through supabaseAdmin().
alter table public.archives enable row level security;

insert into storage.buckets (id, name, public)
values ('archives', 'archives', false)
on conflict (id) do nothing;
