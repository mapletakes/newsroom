-- Run only against an isolated test database with all migrations applied:
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/submission_enrichment.sql
-- Fixtures and assertions are rolled back, including on an assertion failure.
begin;

do $$
declare
  channel uuid := '00000000-0000-4000-8000-000000000010';
  other_channel uuid := '00000000-0000-4000-8000-000000000020';
  item uuid := '00000000-0000-4000-8000-000000000001';
  token_a uuid := '00000000-0000-4000-8000-000000000030';
  token_b uuid := '00000000-0000-4000-8000-000000000040';
  result public.submissions;
  affected integer;
begin
  insert into public.streams(id, twitch_user_id, twitch_login)
    values (channel, 'enrichment-test-one', 'enrichment-test-one'),
           (other_channel, 'enrichment-test-two', 'enrichment-test-two');
  insert into public.submissions(id, stream_id, url, normalized_url, kind, status, mod_notes)
    values (item, channel, 'https://example.com/fixture', 'https://example.com/fixture', 'article', 'pending', 'Keep this editorial note');

  select * into result from public.submissions where id = item;
  assert result.enrichment_state = 'idle', 'Pending items must not enqueue paid work';
  assert not exists(select 1 from public.claim_submission_enrichment(item, channel, token_a)), 'Pending work must not be claimable';

  update public.submissions set status = 'approved' where id = item;
  select * into result from public.submissions where id = item;
  assert result.enrichment_state = 'queued', 'Approval must persist queued work atomically';
  assert not exists(select 1 from public.claim_submission_enrichment(item, other_channel, token_a, true)), 'A foreign channel must not claim work';

  select * into result from public.claim_submission_enrichment(item, channel, token_a);
  assert result.enrichment_state = 'running' and result.enrichment_token = token_a, 'First claim must own the lease';
  assert not exists(select 1 from public.claim_submission_enrichment(item, channel, token_b)), 'A second worker must not claim active work';
  assert not exists(select 1 from public.claim_submission_enrichment(item, channel, token_b, true)), 'Retry must not steal an active lease';

  update public.submissions set status = 'pending' where id = item;
  update public.submissions set status = 'approved' where id = item;
  assert not exists(select 1 from public.claim_submission_enrichment(item, channel, token_b)), 'Undo/reapproval must not create a second worker';

  update public.submissions set enrichment_updated_at = now() - interval '6 minutes' where id = item;
  select * into result from public.claim_submission_enrichment(item, channel, token_b);
  assert result.enrichment_token = token_b, 'Interrupted work must be reclaimable';
  update public.submissions set summary = 'Old worker result', enrichment_state = 'complete'
    where id = item and enrichment_token = token_a;
  get diagnostics affected = row_count;
  assert affected = 0, 'An expired worker must not overwrite the new lease';

  update public.submissions set enrichment_state = 'failed', enrichment_token = null, enrichment_error = 'Retry available'
    where id = item and enrichment_token = token_b;
  assert not exists(select 1 from public.claim_submission_enrichment(item, channel, token_a)), 'A provider failure requires an explicit retry';
  select * into result from public.claim_submission_enrichment(item, channel, token_a, true);
  assert result.enrichment_state = 'running' and result.enrichment_error is null, 'Explicit retry must clear the previous failure';
  assert result.mod_notes = 'Keep this editorial note', 'Processing state must preserve editorial notes';

  update public.submissions set summary = 'Saved summary', enrichment_state = 'complete', enrichment_token = null
    where id = item and enrichment_token = token_a;
  update public.submissions set status = 'pending' where id = item;
  update public.submissions set status = 'approved' where id = item;
  assert not exists(select 1 from public.claim_submission_enrichment(item, channel, token_b, true)), 'Completed work must not be charged again';

  update public.submissions set summary = null, enrichment_state = 'queued' where id = item;
  update public.streams set approved = false where id = channel;
  assert not exists(select 1 from public.claim_submission_enrichment(item, channel, token_a, true)), 'Blocked channels must not invoke paid work';
  update public.streams set approved = true where id = channel;
  update public.submissions set status = 'rejected' where id = item;
  assert not exists(select 1 from public.claim_submission_enrichment(item, channel, token_a, true)), 'Rejected work must not start';

  update public.submissions set status = 'approved', enrichment_state = 'skipped' where id = item;
  assert not exists(select 1 from public.claim_submission_enrichment(item, channel, token_a, true)), 'Intentionally skipped work must not repeat';

  update public.submissions set enrichment_state = 'queued' where id = item;
  update public.submissions set summary = 'Inline result from an older application' where id = item;
  select * into result from public.submissions where id = item;
  assert result.enrichment_state = 'complete', 'Inline writes during application rollback must not leave queued work';

  assert not has_function_privilege('anon', 'public.claim_submission_enrichment(uuid,uuid,uuid,boolean)', 'execute'), 'Anonymous callers must not claim work';
  assert not has_function_privilege('authenticated', 'public.claim_submission_enrichment(uuid,uuid,uuid,boolean)', 'execute'), 'Browser-authenticated callers must not bypass session checks';
  assert has_function_privilege('service_role', 'public.claim_submission_enrichment(uuid,uuid,uuid,boolean)', 'execute'), 'The server must be able to claim work';
end
$$;

rollback;
