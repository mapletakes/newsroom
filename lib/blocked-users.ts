// The super-admin block list: people who can't use the app at all.
//
// isBlocked() runs on every authenticated request (see lib/session-guard.ts), so
// it reads the whole list, which is tiny, and keeps it for a few seconds rather
// than querying per request. A block therefore reaches every running server
// within BLOCKED_TTL_MS.

import { supabaseAdmin } from './supabase';
import { getAppAccessToken } from './twitch-eventsub';

type Sb = ReturnType<typeof supabaseAdmin>;

export type BlockedUser = {
  twitch_user_id: string;
  twitch_login: string;
  reason: string | null;
  blocked_by_login: string;
  created_at: string;
};

const BLOCKED_TTL_MS = 10_000;
const COLUMNS = 'twitch_user_id, twitch_login, reason, blocked_by_login, created_at';

let cache: { ids: Set<string>; until: number } | null = null;
let warned = false;

export function clearBlockedCache(): void {
  cache = null;
}

async function loadBlockedIds(): Promise<Set<string>> {
  try {
    const { data, error } = await supabaseAdmin().from('blocked_users').select('twitch_user_id');
    if (!error) return new Set((data ?? []).map((row: { twitch_user_id: string }) => row.twitch_user_id));
    if (!warned) {
      console.error('blocked-users: lookup failed:', error.message);
      warned = true;
    }
  } catch (err) {
    if (!warned) {
      console.error('blocked-users: lookup failed:', err);
      warned = true;
    }
  }
  // The block list is a second lock, not the only one. If it can't be read (the
  // table isn't migrated yet, or the database hiccuped) keep the last list we
  // had rather than locking every user out of the app.
  return cache?.ids ?? new Set();
}

/** Whether this Twitch account is blocked. `fresh` skips the cache, for the
 *  moment of signing in. */
export async function isBlocked(twitchUserId: string | undefined, opts: { fresh?: boolean } = {}): Promise<boolean> {
  if (!twitchUserId) return false;
  if (opts.fresh || !cache || cache.until <= Date.now()) {
    cache = { ids: await loadBlockedIds(), until: Date.now() + BLOCKED_TTL_MS };
  }
  return cache.ids.has(twitchUserId);
}

export async function listBlockedUsers(sb: Sb): Promise<BlockedUser[]> {
  const { data, error } = await sb.from('blocked_users').select(COLUMNS).order('created_at', { ascending: false });
  if (error) {
    console.error('blocked-users: list failed:', error.message);
    return [];
  }
  return data ?? [];
}

/**
 * Blocks a person, and removes them as a moderator everywhere, so they vanish
 * from every channel's mod list and roster. Their own channel, if they have
 * one, keeps capturing chat: this stops a person, not a channel.
 */
export async function blockUser(
  sb: Sb,
  user: { id: string; login: string },
  blockedBy: string,
  reason: string | null,
): Promise<{ ok: true; user: BlockedUser } | { ok: false; error: string }> {
  const { data, error } = await sb
    .from('blocked_users')
    .upsert(
      { twitch_user_id: user.id, twitch_login: user.login, reason, blocked_by_login: blockedBy },
      { onConflict: 'twitch_user_id' },
    )
    .select(COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'could not save the block' };

  // The block already holds without this; it only tidies the lists.
  const { error: modErr } = await sb.from('moderators').delete().eq('twitch_user_id', user.id);
  if (modErr) console.error('blocked-users: clearing moderator rows failed:', modErr.message);

  clearBlockedCache();
  return { ok: true, user: data };
}

export async function unblockUser(sb: Sb, twitchUserId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await sb.from('blocked_users').delete().eq('twitch_user_id', twitchUserId);
  if (error) return { ok: false, error: error.message };
  clearBlockedCache();
  return { ok: true };
}

/** A Twitch account by login: the account, null if there is none, or 'error'
 *  when Twitch couldn't be asked. */
export async function lookupTwitchUserByLogin(
  login: string,
): Promise<{ id: string; login: string; display_name: string } | null | 'error'> {
  try {
    const token = await getAppAccessToken();
    const r = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, {
      headers: { Authorization: `Bearer ${token}`, 'Client-Id': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID! },
    });
    if (!r.ok) return 'error';
    const user = (await r.json()).data?.[0];
    return user ? { id: user.id, login: user.login, display_name: user.display_name } : null;
  } catch {
    return 'error';
  }
}
