// Who may open a channel's suspicious-user log: its streamer, and people Twitch
// says moderate that channel right now.
//
// The `moderators` table can't answer the second part. Its rows are never
// removed and a mod's session cookie lasts 30 days, so someone removed as a mod
// would keep reading messages Twitch withholds from everyone else. Every mod is
// checked against Twitch instead, and any doubt denies access.

import { getValidAccessToken } from './announce';
import { getApprovedSession, type Session } from './session';
import { supabaseAdmin } from './supabase';
import type { SuspiciousLogStatus } from './suspicious-log';
import { TwitchApiError, fetchModeratedChannels } from './twitch-oauth';

export type LogDenied = 'unauthenticated' | 'forbidden' | 'reconnect' | 'twitch';

export type LogAccess =
  | {
      ok: true;
      role: Session['role'];
      streamId: string;
      logEnabled: boolean;
      logStatus: SuspiciousLogStatus;
      logStatusAt: string | null;
    }
  | { ok: false; reason: LogDenied };

// How long a confirmed mod is trusted before asking Twitch again. Only
// confirmations are remembered, so a refusal is never cached.
const MOD_CHECK_TTL_MS = 5 * 60 * 1000;
const confirmedMods = new Map<string, number>();

export function clearModCheckCache(): void {
  confirmedMods.clear();
}

async function checkCurrentMod(modUserId: string, broadcasterId: string): Promise<true | LogDenied> {
  const key = `${broadcasterId}:${modUserId}`;
  if ((confirmedMods.get(key) ?? 0) > Date.now()) return true;
  confirmedMods.delete(key);

  // The mod's own token, stored on their own stream row at sign-in.
  const { data: own } = await supabaseAdmin()
    .from('streams')
    .select('id')
    .eq('twitch_user_id', modUserId)
    .maybeSingle();
  const token = own ? await getValidAccessToken(own.id) : null;
  if (!token) return 'reconnect';

  try {
    const channels = await fetchModeratedChannels(token, modUserId, { strict: true });
    if (!channels.some((c) => c.broadcaster_id === broadcasterId)) return 'forbidden';
  } catch (err) {
    if (err instanceof TwitchApiError && (err.status === 401 || err.status === 403)) return 'reconnect';
    console.error('suspicious-log: mod check failed:', err);
    return 'twitch';
  }

  confirmedMods.set(key, Date.now() + MOD_CHECK_TTL_MS);
  return true;
}

export async function getSuspiciousLogAccess(): Promise<LogAccess> {
  const session = await getApprovedSession();
  if (!session) return { ok: false, reason: 'unauthenticated' };
  if (!session.twitchUserId) return { ok: false, reason: 'forbidden' };

  const { data: stream } = await supabaseAdmin()
    .from('streams')
    .select('twitch_user_id, suspicious_log_enabled, suspicious_log_status, suspicious_log_status_at')
    .eq('id', session.streamId)
    .maybeSingle();
  if (!stream?.twitch_user_id) return { ok: false, reason: 'forbidden' };

  const logEnabled = stream.suspicious_log_enabled === true;
  const granted: LogAccess = {
    ok: true,
    role: session.role,
    streamId: session.streamId,
    logEnabled,
    logStatus: (stream.suspicious_log_status ?? 'off') as SuspiciousLogStatus,
    logStatusAt: stream.suspicious_log_status_at ?? null,
  };

  // A streamer keeps access after the module is turned off, so entries that
  // are still stored can be reviewed and deleted.
  if (session.role === 'streamer') {
    return session.twitchUserId === stream.twitch_user_id ? granted : { ok: false, reason: 'forbidden' };
  }

  if (!logEnabled) return { ok: false, reason: 'forbidden' };
  const check = await checkCurrentMod(session.twitchUserId, stream.twitch_user_id);
  return check === true ? granted : { ok: false, reason: check };
}
