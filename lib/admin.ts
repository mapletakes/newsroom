// Super-admin gate. Admins are listed by Twitch user id in the
// ADMIN_TWITCH_IDS env var (comma-separated).

export function adminTwitchIds(): Set<string> {
  return new Set(
    (process.env.ADMIN_TWITCH_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isAdmin(twitchUserId: string | null | undefined): boolean {
  if (!twitchUserId) return false;
  return adminTwitchIds().has(twitchUserId);
}

// When set, brand-new streamers start unapproved (pending admin approval).
export function requireApproval(): boolean {
  return process.env.REQUIRE_APPROVAL === 'true';
}

/**
 * Opt-in feature modules a super-admin can flip per channel — each one a
 * `streams.<key>_enabled` boolean column. Adding a new gated feature is one
 * entry here: it's what the admin table's columns and toggle route are
 * driven from, rather than each getting its own hand-copied column, toggle
 * function and route the way questions/mod-status/raffle did the first time
 * around.
 */
export const CHANNEL_MODULES = [
  { key: 'questions_enabled', label: 'Questions', blurb: 'Chat Q&A — the !question-style command' },
  { key: 'mod_status_enabled', label: 'Mod status', blurb: 'Mod availability board (green/yellow/red)' },
  { key: 'raffle_enabled', label: 'Raffle', blurb: 'Chat raffles — !enter, timed, random draw' },
] as const;

export type ChannelModuleKey = (typeof CHANNEL_MODULES)[number]['key'];

// `flag` arrives over the wire as a plain string and lands in an `update()`
// column name — this is the allowlist check that keeps it from being one.
export function isChannelModuleKey(key: string): key is ChannelModuleKey {
  return CHANNEL_MODULES.some((m) => m.key === key);
}

// Rough per-operation cost estimates (USD) for the admin usage view. These are
// ballpark figures, not billed amounts — tune as your model/provider changes.
export const COST_PER_SUMMARY = 0.003; // one Claude enrichment call per item
export const COST_PER_SEARCH = 0.005; // one Brave related-coverage search

export function estimateCost(summaries: number, searches: number): number {
  return summaries * COST_PER_SUMMARY + searches * COST_PER_SEARCH;
}
