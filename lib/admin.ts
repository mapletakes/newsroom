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

// Rough per-operation cost estimates (USD) for the admin usage view. These are
// ballpark figures, not billed amounts — tune as your model/provider changes.
export const COST_PER_SUMMARY = 0.003; // one Claude enrichment call per item
export const COST_PER_SEARCH = 0.005; // one Brave related-coverage search

export function estimateCost(summaries: number, searches: number): number {
  return summaries * COST_PER_SUMMARY + searches * COST_PER_SEARCH;
}
