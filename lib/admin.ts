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
