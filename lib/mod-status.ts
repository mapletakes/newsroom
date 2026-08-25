// Mod availability — the shared vocabulary behind the status board.
//
// Self-reported, never inferred: there's no heartbeat and nothing is derived
// from being logged in. That's a deliberate scope choice (monitoring who's
// connected is a different, heavier feature), and it's why every surface
// renders the age beside the colour — a status is only as good as how
// recently someone stood behind it, so the UI never shows one without saying
// when it was set.

export const MOD_STATUSES = ['green', 'yellow', 'red'] as const;
export type ModStatus = (typeof MOD_STATUSES)[number];

/** A mod who has never set one. Stored as null, not a fourth enum value —
 *  "hasn't said" is the absence of a claim, not a claim of its own. */
export type ModStatusValue = ModStatus | null;

export const MOD_STATUS_LABELS: Record<ModStatus, string> = {
  green: 'Here and attentive',
  yellow: 'Here, split attention',
  red: 'Not available',
};

/** Short form for tight spots (the roster strip, the deck rail). */
export const MOD_STATUS_SHORT: Record<ModStatus, string> = {
  green: 'Attentive',
  yellow: 'Partial',
  red: 'Away',
};

/** Palette tokens rather than raw colours, so a stream's theme still applies.
 *  moss/ochre/rust are the app's existing success/highlight/alert trio. */
export const MOD_STATUS_TOKEN: Record<ModStatus, string> = {
  green: 'moss',
  yellow: 'ochre',
  red: 'rust',
};

// Long enough for "putting the kid down, back in 20", short enough that the
// roster stays scannable at a glance — the whole point is reading the board
// in one look, not reading paragraphs.
export const MAX_STATUS_NOTE_CHARS = 80;

export function sanitizeModStatus(raw: unknown): ModStatusValue {
  return typeof raw === 'string' && (MOD_STATUSES as readonly string[]).includes(raw)
    ? (raw as ModStatus)
    : null;
}

/** Trim, collapse internal whitespace to single spaces, cap length. Returns
 *  null for anything with nothing left after cleanup, so "clear my note" and
 *  "never had one" store identically. */
export function sanitizeStatusNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  if (collapsed.length <= MAX_STATUS_NOTE_CHARS) return collapsed;
  return collapsed.slice(0, MAX_STATUS_NOTE_CHARS - 1).trimEnd() + '…';
}

// Past this, a status has aged out of "current" and the UI de-emphasises it.
// Not enforced server-side and it never rewrites the stored value — showing
// someone their own stale green is more useful than silently resetting it,
// because the fix is for THEM to update it.
export const STATUS_STALE_AFTER_MS = 2 * 60 * 60 * 1000; // 2 hours

export function isStatusStale(updatedAt: string | null | undefined, now = Date.now()): boolean {
  if (!updatedAt) return false; // never set — not stale, just absent
  const t = new Date(updatedAt).getTime();
  if (Number.isNaN(t)) return false;
  return now - t > STATUS_STALE_AFTER_MS;
}

// A genuinely different concern from the 2-hour dim above: that one nudges
// the person who set it to update their own, and deliberately never rewrites
// the row. This is the backstop for when they never do — someone who went
// home hours ago (or a whole stream ago) shouldn't still read as "green" to
// the rest of the team indefinitely, so past this the row is actually reset
// to no status server-side, not just dimmed. Enforced in two places: lazily
// whenever the roster is fetched (so an active viewer never sees stale data,
// win or lose the race with the cron), and by the daily cleanup cron as a
// backstop for streams nobody's currently looking at.
export const STATUS_RESET_AFTER_MS = 12 * 60 * 60 * 1000; // 12 hours

// A third, longer-running concern: a mod removed on Twitch (or who's just
// stopped covering the stream) still has a row in `moderators` — nothing
// currently syncs a de-mod back here, so there's no removal signal to key
// off. Past this, their row simply stops appearing on the roster. Much
// longer than the reset above on purpose: that one is about whether a status
// VALUE is still current, this one is about whether the ACCOUNT is still
// worth showing at all, and the two aren't meant to line up.
export const ROSTER_INACTIVE_AFTER_MS = 96 * 60 * 60 * 1000; // 96 hours

/** True if this row has gone quiet long enough to drop off the roster —
 *  including a mod who's never set a status at all (`updatedAt` null),
 *  since there's nothing to show for them either. The viewer's OWN row is
 *  never filtered by this: see the /api/mod-status GET handler. */
export function isRosterInactive(updatedAt: string | null | undefined, now = Date.now()): boolean {
  if (!updatedAt) return true;
  const t = new Date(updatedAt).getTime();
  if (Number.isNaN(t)) return true;
  return now - t > ROSTER_INACTIVE_AFTER_MS;
}
