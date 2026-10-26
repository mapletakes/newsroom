-- Approval and processing are separate operations. Queue work in the same
-- transaction as approval so a function timeout cannot lose the work.
alter table public.submissions
  add column enrichment_state text not null default 'idle'
    check (enrichment_state in ('idle', 'queued', 'running', 'complete', 'skipped', 'failed')),
  add column enrichment_token uuid,
  add column enrichment_updated_at timestamptz,
  add column enrichment_error text;

update public.submissions
set enrichment_state = case when summary is not null then 'complete' else 'queued' end,
    enrichment_updated_at = now()
where status = 'approved' or summary is not null;

create index submissions_enrichment_idx
  on public.submissions (stream_id, enrichment_state, enrichment_updated_at)
  where enrichment_state in ('queued', 'running');

create function public.queue_submission_enrichment()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.summary is not null and new.enrichment_state in ('idle', 'queued', 'failed') then
    -- Older application versions may still write summaries inline during a
    -- rollback. Do not leave those rows queued or offer unnecessary retries.
    new.enrichment_state := 'complete';
    new.enrichment_error := null;
    new.enrichment_updated_at := now();
  elsif new.status = 'approved' and new.enrichment_state = 'idle' then
    new.enrichment_state := case when new.summary is not null then 'complete' else 'queued' end;
    new.enrichment_updated_at := now();
  end if;
  return new;
end
$$;

create trigger queue_submission_enrichment
before insert or update of status, summary on public.submissions
for each row execute function public.queue_submission_enrichment();

-- One UPDATE claims a row across concurrent function invocations. A lease
-- outlives the route's 60-second limit; only interrupted work is reclaimed.
-- Completion must match the returned token, fencing off an expired worker.
create function public.claim_submission_enrichment(
  p_id uuid, p_stream_id uuid, p_token uuid, p_retry boolean default false
)
returns setof public.submissions
language sql set search_path = public as $$
  update public.submissions
  set enrichment_state = 'running', enrichment_token = p_token,
      enrichment_updated_at = now(), enrichment_error = null
  where id = p_id and stream_id = p_stream_id and status = 'approved'
    and exists (select 1 from public.streams where id = p_stream_id and approved is not false)
    and summary is null
    and (
      enrichment_state = 'queued'
      or (enrichment_state = 'running' and enrichment_updated_at < now() - interval '5 minutes')
      or (p_retry and enrichment_state = 'failed')
    )
  returning *
$$;

revoke execute on function public.queue_submission_enrichment() from public, anon, authenticated;
revoke execute on function public.claim_submission_enrichment(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_submission_enrichment(uuid, uuid, uuid, boolean) to service_role;
