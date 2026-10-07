import { fetchModeratedChannels } from './twitch-oauth';
import { encryptSecret } from './crypto';
import type { supabaseAdmin } from './supabase';

type Sb = ReturnType<typeof supabaseAdmin>;
type Tokens = { access_token: string; refresh_token: string; expires_in: number };
type TwitchUser = { id: string; login: string; display_name: string };

/** Records, for every Newsroom channel this Twitch user moderates, a
 *  `moderators` row so the streamer can grant them deck access. Shared by a
 *  normal Twitch sign-in and by linking Twitch to an email account. */
export async function syncModeratorRows(sb: Sb, accessToken: string, user: TwitchUser): Promise<void> {
  const modChannels = await fetchModeratedChannels(accessToken, user.id);
  if (modChannels.length === 0) return;

  const { data: matched } = await sb
    .from('streams')
    .select('id')
    .in('twitch_user_id', modChannels.map((c) => c.broadcaster_id));

  for (const ms of matched ?? []) {
    await sb.from('moderators').upsert(
      { stream_id: ms.id, twitch_user_id: user.id, twitch_login: user.login },
      { onConflict: 'stream_id,twitch_user_id' },
    );
  }
}

export type LinkResult = { ok: true } | { ok: false; reason: 'taken' | 'already-linked' | 'error' };

/**
 * Attaches a Twitch identity (and its chat tokens) to an existing stream that
 * was created by email sign-in, so the person keeps their deck and shelves and
 * gains the chat features.
 *
 * Refuses, rather than merges, when that Twitch account already has a stream
 * of its own: merging two streams' decks, shelves and history is a different
 * and much riskier feature than linking.
 *
 * After linking, the account's canonical id becomes the Twitch user id (the
 * same value a Twitch sign-in uses), so signing in either way lands on the
 * same stream with the same per-person preferences.
 */
export async function linkTwitchToStream(args: {
  sb: Sb;
  streamId: string;
  /** The email account's current id (the Supabase auth user id). */
  accountId: string;
  tokens: Tokens;
  user: TwitchUser;
}): Promise<LinkResult> {
  const { sb, streamId, accountId, tokens, user } = args;

  const { data: stream } = await sb
    .from('streams')
    .select('id, twitch_user_id')
    .eq('id', streamId)
    .maybeSingle();
  if (!stream) return { ok: false, reason: 'error' };
  if (stream.twitch_user_id) return { ok: false, reason: 'already-linked' };

  const { data: owner } = await sb
    .from('streams')
    .select('id')
    .eq('twitch_user_id', user.id)
    .maybeSingle();
  if (owner) return { ok: false, reason: 'taken' };

  const { error } = await sb
    .from('streams')
    .update({
      twitch_user_id: user.id,
      twitch_login: user.login,
      display_name: user.display_name,
      access_token: encryptSecret(tokens.access_token),
      refresh_token: encryptSecret(tokens.refresh_token),
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    })
    .eq('id', streamId)
    .is('twitch_user_id', null); // lose a race cleanly instead of overwriting
  if (error) {
    // 23505 = unique violation: someone claimed this Twitch id between the
    // check above and now.
    return { ok: false, reason: error.code === '23505' ? 'taken' : 'error' };
  }

  // Move per-person preferences to the new canonical id. If the Twitch account
  // already has prefs (it may have moderated elsewhere before), those win.
  const { data: existingPrefs } = await sb
    .from('user_prefs')
    .select('account_id')
    .eq('account_id', user.id)
    .maybeSingle();
  if (existingPrefs) {
    await sb.from('user_prefs').delete().eq('account_id', accountId);
  } else {
    await sb
      .from('user_prefs')
      .update({ account_id: user.id, twitch_user_id: user.id })
      .eq('account_id', accountId);
  }

  return { ok: true };
}
