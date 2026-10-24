-- Keep cancelled play records for inspection, but exclude them from active
-- history and exports. Receipts identify included notes rather than advancing
-- past a wall-clock timestamp that can hide a concurrently committed play.
alter table public.show_notes
  add column cancelled_at timestamptz,
  add column markdown_exported_at timestamptz,
  add column discord_posted_at timestamptz;

alter table public.streams
  add column discord_export_token uuid,
  add column discord_export_started_at timestamptz;

-- Preserve the previous export boundaries when adopting note-level receipts.
update public.show_notes n
set markdown_exported_at = case when n.played_at <= s.notes_exported_at then s.notes_exported_at end,
    discord_posted_at = case when n.played_at <= s.discord_posted_at then s.discord_posted_at end
from public.streams s where s.id = n.stream_id;

-- Old retries could insert several notes for one play. Retain the latest
-- play's first note, cancelling the others without deleting their contents.
with ranked as (
  select id, row_number() over (
    partition by submission_id order by played_at desc, created_at, id
  ) as rank from public.show_notes where submission_id is not null
)
update public.show_notes n set cancelled_at = now()
from ranked r where r.id = n.id and r.rank > 1;

-- Undo used to leave its note behind. Detached notes from cleared submissions
-- remain active; only linked submissions that are no longer played cancel.
update public.show_notes n set cancelled_at = now()
from public.submissions s
where n.submission_id = s.id and s.status <> 'played' and n.cancelled_at is null;

create unique index show_notes_active_play_idx on public.show_notes (submission_id)
  where submission_id is not null and cancelled_at is null;

create index show_notes_pending_markdown_idx on public.show_notes (stream_id, played_at, id)
  where cancelled_at is null and markdown_exported_at is null;
create index show_notes_pending_discord_idx on public.show_notes (stream_id, played_at, id)
  where cancelled_at is null and discord_posted_at is null;

create function public.set_submission_play_time()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'played' then
    if tg_op = 'UPDATE' and old.status = 'played' then
      new.played_at := old.played_at;
      new.duration_on_screen_s := old.duration_on_screen_s;
    else
      new.played_at := clock_timestamp();
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'played' then
    new.played_at := null;
    new.duration_on_screen_s := null;
  end if;
  return new;
end
$$;

create function public.sync_submission_play_note()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'played' then
    -- The status change and note insert commit together. Retrying a played
    -- request preserves its original timestamp, note, and export receipts.
    insert into public.show_notes (
      stream_id, submission_id, played_at, title, url, summary, archive_url, takeaway
    ) values (
      new.stream_id, new.id, new.played_at, new.title, new.url,
      new.summary, new.archive_url, new.prep_note
    ) on conflict (submission_id)
      where submission_id is not null and cancelled_at is null do nothing;
  elsif tg_op = 'UPDATE' and old.status = 'played' then
    update public.show_notes set cancelled_at = clock_timestamp()
    where submission_id = new.id and cancelled_at is null;
  end if;
  return new;
end
$$;

create trigger set_submission_play_time
before insert or update of status on public.submissions
for each row execute function public.set_submission_play_time();

create trigger sync_submission_play_note
after insert or update of status on public.submissions
for each row execute function public.sync_submission_play_note();

-- A scalar JSON aggregate avoids PostgREST's default row cap and returns one
-- statement snapshot. Notes committed after it stay unacknowledged for next time.
create function public.read_show_notes(p_stream_id uuid, p_destination text)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  if p_destination not in ('history', 'markdown', 'discord') then
    raise exception 'Invalid notes destination';
  end if;
  return (
    -- Separate branches let each destination use its pending-note index even
    -- when PostgreSQL caches a generic plan for this frequently called RPC.
    with selected_notes as (
      select * from public.show_notes where stream_id = p_stream_id
        and cancelled_at is null and p_destination = 'history'
      union all
      select * from public.show_notes where stream_id = p_stream_id
        and cancelled_at is null and markdown_exported_at is null and p_destination = 'markdown'
      union all
      select * from public.show_notes where stream_id = p_stream_id
        and cancelled_at is null and discord_posted_at is null and p_destination = 'discord'
    )
    select coalesce(jsonb_agg(
      to_jsonb(n) || jsonb_build_object('archive_url', coalesce(n.archive_url, s.archive_url))
      order by n.played_at, n.id
    ), '[]'::jsonb)
    from selected_notes n left join public.submissions s on s.id = n.submission_id
  );
end
$$;

create function public.claim_discord_export(p_stream_id uuid, p_token uuid)
returns boolean language sql set search_path = public as $$
  with claimed as (
    update public.streams
    set discord_export_token = p_token, discord_export_started_at = clock_timestamp()
    where id = p_stream_id and approved is not false and (
      discord_export_token is null or discord_export_started_at < clock_timestamp() - interval '5 minutes'
    ) returning id
  ) select exists(select 1 from claimed)
$$;

create function public.acknowledge_show_notes(
  p_stream_id uuid, p_destination text, p_ids uuid[], p_token uuid default null
)
returns integer language plpgsql set search_path = public as $$
declare
  export_token uuid;
  affected integer;
  acknowledged_at timestamptz := clock_timestamp();
begin
  if p_destination not in ('markdown', 'discord') then
    raise exception 'Invalid notes destination';
  end if;
  select discord_export_token into export_token from public.streams
    where id = p_stream_id for update;
  if not found then raise exception 'Channel not found'; end if;
  if p_destination = 'discord' and (p_token is null or export_token is distinct from p_token) then
    raise exception 'Export lease is no longer valid';
  end if;

  if p_destination = 'markdown' then
    update public.show_notes set markdown_exported_at = acknowledged_at
    where stream_id = p_stream_id and id = any(p_ids) and markdown_exported_at is null;
  else
    update public.show_notes set discord_posted_at = acknowledged_at
    where stream_id = p_stream_id and id = any(p_ids) and discord_posted_at is null;
  end if;
  get diagnostics affected = row_count;
  if affected > 0 then
    -- Retain these fields as last-export metadata for older consumers. The
    -- new readers use per-note receipts, so neither timestamp can hide a note.
    if p_destination = 'markdown' then
      update public.streams set notes_exported_at = greatest(notes_exported_at, acknowledged_at)
        where id = p_stream_id;
    else
      update public.streams set discord_posted_at = greatest(discord_posted_at, acknowledged_at)
        where id = p_stream_id;
    end if;
  end if;
  return affected;
end
$$;

revoke execute on function public.set_submission_play_time() from public, anon, authenticated;
revoke execute on function public.sync_submission_play_note() from public, anon, authenticated;
revoke execute on function public.read_show_notes(uuid, text) from public, anon, authenticated;
revoke execute on function public.claim_discord_export(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.acknowledge_show_notes(uuid, text, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.read_show_notes(uuid, text) to service_role;
grant execute on function public.claim_discord_export(uuid, uuid) to service_role;
grant execute on function public.acknowledge_show_notes(uuid, text, uuid[], uuid) to service_role;
