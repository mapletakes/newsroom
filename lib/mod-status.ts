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
