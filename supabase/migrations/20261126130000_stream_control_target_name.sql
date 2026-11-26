-- The scene or source name a stream-control command was aimed at, as it was
-- named when the command was made. The streamer's log reads "who hid what" for
-- 30 days; ids alone stop meaning anything once a scene is renamed or deleted.
alter table public.stream_control_commands add column if not exists target_name text
  check (target_name is null or char_length(target_name) <= 200);
