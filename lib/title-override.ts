// A streamer-authored replacement for an item's title — see
// supabase/migrations/20260921154644_add_submission_title_override.sql for
// why it's a separate column rather than an edit to `title`.

// Generous for a headline, small enough that a paste of a whole paragraph is
// clearly a mistake. The chat post truncates to Twitch's own limit on top of
// this (see buildWatchingMessage in lib/announce.ts).
export const MAX_TITLE_OVERRIDE_CHARS = 200;

/** Trims and caps user input; blank means "no override" (null). */
export function normalizeTitleOverride(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, MAX_TITLE_OVERRIDE_CHARS).trim();
  return trimmed || null;
}

/**
 * The title viewers should see: the override if there is one, else the
 * scraped title, else null (callers fall back to the url themselves, since
 * what "no title at all" looks like differs per surface).
 */
export function resolveTitle(s: {
  title: string | null;
  title_override?: string | null;
}): string | null {
  return s.title_override?.trim() || s.title || null;
}
