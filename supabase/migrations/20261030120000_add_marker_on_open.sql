-- Opt-in: pressing "Open source" on the deck also drops a Twitch stream marker
-- (description = the item's title) at that moment of the live broadcast.
-- Off by default: it needs the channel:manage:broadcasts Twitch scope, which
-- accounts connected before this shipped don't have until they reconnect.
alter table public.streams add column if not exists marker_on_open boolean default false;
