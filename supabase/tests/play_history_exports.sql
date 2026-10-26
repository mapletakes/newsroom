-- Run on an isolated database with all migrations applied:
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/play_history_exports.sql
begin;

create function pg_temp.reject_test_note()
returns trigger language plpgsql as $$
begin
  if new.url = 'https://example.com/reject-note-write' then
    raise exception 'Injected note-write failure';
  end if;
  return new;
end
$$;
create trigger reject_test_note before insert on public.show_notes
for each row execute function pg_temp.reject_test_note();

do $$
declare
  channel uuid := '00000000-0000-4000-8000-000000000010';
  other_channel uuid := '00000000-0000-4000-8000-000000000020';
  item uuid := '00000000-0000-4000-8000-000000000001';
  broken_item uuid := '00000000-0000-4000-8000-000000000002';
  token_a uuid := '00000000-0000-4000-8000-000000000030';
  token_b uuid := '00000000-0000-4000-8000-000000000040';
  first_note public.show_notes;
  replay_note public.show_notes;
  snapshot jsonb;
  snapshot_ids uuid[];
  late_id uuid;
  foreign_id uuid;
  failed boolean := false;
begin
  insert into public.streams(id, twitch_user_id, twitch_login)
    values (channel, 'play-history-test-one', 'play-history-test-one'),
           (other_channel, 'play-history-test-two', 'play-history-test-two');
  insert into public.submissions(id, stream_id, url, normalized_url, kind, status, title, prep_note)
    values (item, channel, 'https://example.com/fixture', 'https://example.com/fixture', 'article', 'approved', 'First title', 'First takeaway'),
           (broken_item, channel, 'https://example.com/reject-note-write', 'https://example.com/reject-note-write', 'article', 'approved', 'Broken write', null);

  update public.submissions set status = 'played', duration_on_screen_s = 12 where id = item;
  select * into first_note from public.show_notes where submission_id = item and cancelled_at is null;
  assert first_note.id is not null, 'A play must create its note in the same transaction';
  assert first_note.takeaway = 'First takeaway', 'The note must snapshot the played takeaway';
  assert first_note.played_at = (select played_at from public.submissions where id = item), 'Submission and note timestamps must agree';

  perform public.acknowledge_show_notes(channel, 'markdown', array[first_note.id]);
  update public.submissions set status = 'played', played_at = now() + interval '1 day', duration_on_screen_s = 100, prep_note = 'Retry payload' where id = item;
  assert (select count(*) from public.show_notes where submission_id = item and cancelled_at is null) = 1, 'A Played retry must not add a second note';
  assert (select played_at from public.submissions where id = item) = first_note.played_at, 'A retry must not move the play timestamp';
  assert (select duration_on_screen_s from public.submissions where id = item) = 12, 'A retry must not overwrite the original duration';
  assert (select takeaway from public.show_notes where id = first_note.id) = 'First takeaway', 'A retry must not overwrite the original note';
  assert jsonb_array_length(public.read_show_notes(channel, 'markdown')) = 0, 'A retry must not reset export receipts';

  update public.submissions set status = 'approved' where id = item;
  assert (select cancelled_at from public.show_notes where id = first_note.id) is not null, 'Undo must cancel the note without deleting its contents';
  assert (select played_at from public.submissions where id = item) is null, 'Undo must clear the submission play time';
  assert jsonb_array_length(public.read_show_notes(channel, 'history')) = 0, 'Cancelled notes must not appear in active history';
  assert jsonb_array_length(public.read_show_notes(channel, 'discord')) = 0, 'Cancelled notes must not appear in pending exports';

  update public.submissions set status = 'played', prep_note = 'Replay takeaway' where id = item;
  select * into replay_note from public.show_notes where submission_id = item and cancelled_at is null;
  assert replay_note.id <> first_note.id, 'Replay must create a new note identity';
  assert replay_note.takeaway = 'Replay takeaway', 'Replay must use the new takeaway';
  perform public.acknowledge_show_notes(channel, 'markdown', array[first_note.id]);
  assert jsonb_array_length(public.read_show_notes(channel, 'markdown')) = 1, 'An old export must not acknowledge the replay';

  begin
    update public.submissions set status = 'played' where id = broken_item;
  exception when others then failed := true;
  end;
  assert failed, 'The injected note-write failure must occur';
  assert (select status from public.submissions where id = broken_item) = 'approved', 'A note failure must roll back the play transition';
  assert (select played_at from public.submissions where id = broken_item) is null, 'A failed transaction must not leave a play timestamp';

  -- Capture the pending export, then commit a late note with an equal play
  -- timestamp. A time-based cursor would skip it; ID receipts leave it pending.
  snapshot := public.read_show_notes(channel, 'markdown');
  select array_agg((note->>'id')::uuid) into snapshot_ids from jsonb_array_elements(snapshot) note;
  insert into public.show_notes(stream_id, url, title, played_at)
    values (channel, 'https://example.com/late', 'Late note', replay_note.played_at) returning id into late_id;
  insert into public.show_notes(stream_id, url, title, played_at)
    values (other_channel, 'https://example.com/foreign', 'Foreign note', replay_note.played_at) returning id into foreign_id;
  perform public.acknowledge_show_notes(channel, 'markdown', snapshot_ids || foreign_id);
  assert jsonb_array_length(public.read_show_notes(channel, 'markdown')) = 1, 'A note outside the snapshot must remain pending';
  assert (public.read_show_notes(channel, 'markdown')->0->>'id')::uuid = late_id, 'The late note must be available next time';
  assert (select markdown_exported_at from public.show_notes where id = foreign_id) is null, 'A foreign-channel ID must not be acknowledged';
  assert jsonb_array_length(public.read_show_notes(channel, 'discord')) = 2, 'Markdown receipts must not consume Discord notes';

  assert public.claim_discord_export(channel, token_a), 'The first Discord export must acquire a lease';
  assert not public.claim_discord_export(channel, token_b), 'A competing export must not acquire an active lease';
  perform public.acknowledge_show_notes(channel, 'discord', array[replay_note.id], token_a);
  assert jsonb_array_length(public.read_show_notes(channel, 'discord')) = 1, 'Acknowledging one message must leave other notes pending';
  failed := false;
  begin
    perform public.acknowledge_show_notes(channel, 'discord', array[late_id], token_b);
  exception when others then failed := true;
  end;
  assert failed, 'A worker without the lease must not save Discord receipts';
  update public.streams set discord_export_started_at = now() - interval '6 minutes' where id = channel;
  assert public.claim_discord_export(channel, token_b), 'An interrupted export must be reclaimable';
  failed := false;
  begin
    perform public.acknowledge_show_notes(channel, 'discord', array[late_id], token_a);
  exception when others then failed := true;
  end;
  assert failed, 'An expired worker must not acknowledge another worker’s export';
  perform public.acknowledge_show_notes(channel, 'discord', array[late_id], token_b);
  assert jsonb_array_length(public.read_show_notes(channel, 'discord')) = 0, 'The remaining message must be independently acknowledgeable';

  delete from public.submissions where id = item;
  assert (select submission_id from public.show_notes where id = replay_note.id) is null, 'Clearing the queue must detach the note';
  assert jsonb_array_length(public.read_show_notes(channel, 'history')) = 2, 'Clearing played submissions must preserve active history';

  -- The scalar snapshot must not silently stop at PostgREST's 1,000-row cap.
  insert into public.show_notes(stream_id, url, played_at)
    select channel, 'https://example.com/bulk/' || n, now() from generate_series(1, 1001) n;
  assert jsonb_array_length(public.read_show_notes(channel, 'history')) = 1003, 'Large exports must include all active notes';

  assert not has_function_privilege('anon', 'public.read_show_notes(uuid,text)', 'execute'), 'Anonymous callers must not read notes';
  assert not has_function_privilege('authenticated', 'public.acknowledge_show_notes(uuid,text,uuid[],uuid)', 'execute'), 'Browser callers must not acknowledge arbitrary notes';
  assert has_function_privilege('service_role', 'public.acknowledge_show_notes(uuid,text,uuid[],uuid)', 'execute'), 'The server must be able to acknowledge exports';
end
$$;

rollback;
