-- GET /api/queue is the highest-frequency endpoint in the app (every open
-- deck/mod tab, every poll interval, every status-tab switch), and it was
-- paying for 5 separate per-status count queries plus a sequential
-- now-playing lookup on every call. Same fix as admin_submission_stats
-- (see the baseline migration) for the same shape of problem: one grouped
-- aggregate instead of a query-per-status fan-out — except scoped to a
-- single stream, so there's no `group by` (an aggregate with none always
-- returns exactly one row, even over zero submissions, which is what keeps
-- the counts defaulting to 0 the same way the old `.count ?? 0` did).
--
-- now_playing is folded in too, as jsonb, rather than left as the app's
-- separate streams-then-submissions round trip: to_jsonb() on the row
-- serializes it exactly like PostgREST's `select('*')` already does,
-- nested jsonb columns (related_coverage) included as real JSON rather
-- than a double-encoded string.
create or replace function public.queue_overview(p_stream_id uuid)
returns table (
  pending bigint,
  approved bigint,
  played bigint,
  rejected bigint,
  total bigint,
  now_playing jsonb
)
language sql
stable
as $$
  select
    count(*) filter (where s.status = 'pending') as pending,
    count(*) filter (where s.status = 'approved') as approved,
    count(*) filter (where s.status = 'played') as played,
    count(*) filter (where s.status = 'rejected') as rejected,
    count(*) as total,
    (
      select to_jsonb(np)
      from public.submissions np
      where np.stream_id = p_stream_id
        and np.id = (select now_playing_id from public.streams where id = p_stream_id)
    ) as now_playing
  from public.submissions s
  where s.stream_id = p_stream_id
$$;

grant execute on function public.queue_overview(uuid) to service_role;
