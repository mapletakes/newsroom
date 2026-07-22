// Shared "post now-playing to chat" logic. Used by the deck's manual
// "Post to chat" button (sender = whoever's logged in) and the !video-style
// chat auto-responder (sender = the streamer's own stored token, since
// nobody's necessarily at the keyboard when a viewer triggers the command).

import { supabaseAdmin } from './supabase';
import { refreshAccessToken, sendChatMessage } from './twitch-oauth';
import { encryptSecret, decryptSecret } from './crypto';
import { sanitizeShareUrl } from './url';

const MAX_CHARS = 500;

// Builds "Watching: <title> <url>", truncating the title (never the url) to
// fit Twitch's message limit. Strips playlist params so an unlisted
// playlist id is never posted publicly.
export function buildWatchingMessage(title: string | null, url: string): string {
  const shareUrl = sanitizeShareUrl(url);
  let t = title || shareUrl;
  const fixed = `Watching:  ${shareUrl}`.length; // "Watching: " + space + url
  if (fixed + t.length > MAX_CHARS) {
    const room = Math.max(0, MAX_CHARS - fixed - 1);
    t = t.slice(0, room) + '…';
  }
  return `Watching: ${t} ${shareUrl}`;
}

export type AnnounceResult = { ok: boolean; error?: string; message?: string };

/**
 * Posts "Watching: <title> <url>" to a channel's chat, sending as the given
 * stream row's OWN stored Twitch account (refreshing its token first if
 * it's expired or about to be). `senderStreamId` is whose stored token to
 * use; `senderTwitchUserId` is that same account's Twitch id, needed
 * separately for the Twitch API call itself.
 */
export async function announceSubmission(
  senderStreamId: string,
  broadcasterTwitchUserId: string,
  senderTwitchUserId: string,
  sub: { title: string | null; url: string },
): Promise<AnnounceResult> {
  const sb = supabaseAdmin();
  const { data: sender } = await sb
    .from('streams')
    .select('id, access_token, refresh_token, token_expires_at')
    .eq('id', senderStreamId)
    .maybeSingle();
  const storedAccess = decryptSecret(sender?.access_token);
  const storedRefresh = decryptSecret(sender?.refresh_token);
  if (!sender || !storedAccess || !storedRefresh) {
    return { ok: false, error: 'reconnect' };
  }

  let accessToken = storedAccess;
  const expMs = sender.token_expires_at ? new Date(sender.token_expires_at).getTime() : 0;
  if (expMs < Date.now() + 60_000) {
    const refreshed = await refreshAccessToken(storedRefresh);
    if (!refreshed) return { ok: false, error: 'reconnect' };
    accessToken = refreshed.access_token;
    await sb
      .from('streams')
      .update({
        access_token: encryptSecret(refreshed.access_token),
        refresh_token: encryptSecret(refreshed.refresh_token),
        token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      })
      .eq('id', sender.id);
  }

  const message = buildWatchingMessage(sub.title, sub.url);
  const result = await sendChatMessage(accessToken, broadcasterTwitchUserId, senderTwitchUserId, message);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, message };
}
