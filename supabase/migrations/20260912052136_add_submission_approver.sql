-- Who approved an item — so the deck can show a small "approved by <mod>"
-- marker on items a mod sent through, distinct from submitter_login (who
-- originally posted the link in chat). Login is the stable identity;
-- display_name is stored alongside it purely so the UI never has to look a
-- mod up again to render the badge (a mod who's since had their permission
-- revoked, or renamed on Twitch, still reads correctly on old items).
--
-- Both null means "not approved by a mod" — either the item is still
-- pending, or the streamer approved/added it themselves. The queue PATCH
-- route (app/api/queue/route.ts) only fills these in when the approving
-- session's role is 'mod', and clears them if the item is later unapproved
-- back to pending (so a re-approval by someone else doesn't inherit stale
-- attribution); lib/deck-add.ts fills them the same way when a mod adds a
-- link straight to the deck, bypassing the pending queue entirely.
alter table public.submissions add column if not exists approved_by_login text;
alter table public.submissions add column if not exists approved_by_display_name text;
