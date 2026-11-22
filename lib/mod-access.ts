// Whether someone holding a mod session still moderates that channel.
//
// A session cookie lasts 30 days and says "mod of channel X". Nothing else ever
// took that away: the moderators table only gains rows, so a person removed on
// Twitch kept the deck, the queue and every mod API until the cookie ran out.
// This is the check that was missing, run for every mod request:
//
//  - the moderators row must still exist (a few seconds' cache), and
//  - Twitch must still list them as a moderator of the channel (a few minutes'
//    cache), asked with the mod's OWN token. Twitch saying no deletes the row.
//
// If Twitch can't be asked (no usable token, or it rejects the token) the answer
// is no: a removed mod must not be able to keep access by revoking their own
// authorization. A transient Twitch failure is the one exception, since nothing
// a mod does can cause one; it lets them through briefly and asks again soon.

import { getValidAccessToken } from './announce';
import { supabaseAdmin } from './supabase';
import { TwitchApiError, fetchModeratedChannels } from './twitch-oauth';

const ROW_TTL_MS = 10_000;
const TWITCH_TTL_MS = 5 * 60_000;
const UNKNOWN_TTL_MS = 30_000;
const DENIED_TTL_MS = 30_000;

// Cache key is `${streamId}:${userId}`. Only "yes" is cached for long: a no
// that was cached for minutes would keep out a mod who has just been re-added.
const rowKnown = new Map<string, number>();
const twitchKnown = new Map<string, number>();
const recentlyDenied = new Map<string, number>();
const inFlight = new Map<string, Promise<boolean>>();

export function clearModAccessCache(): void {
  rowKnown.clear();
  twitchKnown.clear();
  recentlyDenied.clear();
  inFlight.clear();
}

async function rowExists(key: string, streamId: string, userId: string): Promise<boolean> {
  if ((rowKnown.get(key) ?? 0) > Date.now()) return true;
  rowKnown.delete(key);
  const { data, error } = await supabaseAdmin()
    .from('moderators')
    .select('twitch_user_id')
    .eq('stream_id', streamId)
    .eq('twitch_user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`moderator lookup failed: ${error.message}`);
  if (data) rowKnown.set(key, Date.now() + ROW_TTL_MS);
  return !!data;
}

type TwitchAnswer = 'yes' | 'no' | 'unknown';

async function askTwitch(streamId: string, userId: string): Promise<TwitchAnswer> {
  const sb = supabaseAdmin();
  const [{ data: channel }, { data: own }] = await Promise.all([
    sb.from('streams').select('twitch_user_id').eq('id', streamId).maybeSingle(),
    sb.from('streams').select('id').eq('twitch_user_id', userId).maybeSingle(),
  ]);
  // A channel with no Twitch account has no moderators.
  if (!channel?.twitch_user_id) return 'no';

  // The mod's own token, stored on their own stream row when they signed in.
  const token = own ? await getValidAccessToken(own.id) : null;
  if (!token) return 'no';

  try {
    const channels = await fetchModeratedChannels(token, userId, { strict: true });
    if (channels.some((c) => c.broadcaster_id === channel.twitch_user_id)) return 'yes';
    const { error } = await sb.from('moderators').delete().eq('stream_id', streamId).eq('twitch_user_id', userId);
    if (error) console.error('mod-access: removing a former moderator failed:', error.message);
    return 'no';
  } catch (err) {
    if (err instanceof TwitchApiError && (err.status === 401 || err.status === 403)) return 'no';
    console.error('mod-access: Twitch check failed, trusting the stored membership for now:', err);
    return 'unknown';
  }
}

export async function modMembershipValid(streamId: string, userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const key = `${streamId}:${userId}`;
  if ((recentlyDenied.get(key) ?? 0) > Date.now()) return false;
  if (!(await rowExists(key, streamId, userId))) return false;
  if ((twitchKnown.get(key) ?? 0) > Date.now()) return true;

  // Many requests arrive together from one mod's open tabs: one Twitch call.
  const pending = inFlight.get(key);
  if (pending) return pending;

  const check = (async () => {
    try {
      const answer = await askTwitch(streamId, userId);
      if (answer === 'yes') twitchKnown.set(key, Date.now() + TWITCH_TTL_MS);
      else if (answer === 'unknown') twitchKnown.set(key, Date.now() + UNKNOWN_TTL_MS);
      else {
        recentlyDenied.set(key, Date.now() + DENIED_TTL_MS);
        rowKnown.delete(key);
      }
      return answer !== 'no';
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, check);
  return check;
}
