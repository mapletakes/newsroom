// Shared "post now-playing to chat" logic. Used by the deck's manual
// "Post to chat" button (sender = whoever's logged in) and the !video-style
// chat auto-responder (sender = the streamer's own stored token, since
// nobody's necessarily at the keyboard when a viewer triggers the command).

import { supabaseAdmin } from './supabase';
import { refreshAccessToken, sendChatMessage } from './twitch-oauth';
import { encryptSecret, decryptSecret } from './crypto';
import { sanitizeShareUrl } from './url';

const MAX_CHARS = 500;

// A long warning gets its own cap rather than being allowed to eat the whole
// budget — otherwise a rambling one would truncate the title down to nothing
// and the message would no longer say what's actually on screen.
const MAX_TW_CHARS = 180;
const TW_PREFIX = '⚠ TW: ';

function ellipsize(s: string, max: number): string {
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + '…' : s;
}

// Builds "Watching: <title> <url>", plus " ⚠ TW: <warning>" when the item
// carries one, truncating the title (never the url, never the warning's
// prefix) to fit Twitch's message limit. Strips playlist params so an
// unlisted playlist id is never posted publicly.
export function buildWatchingMessage(
  title: string | null,
  url: string,
  triggerWarning?: string | null,
): string {
  const shareUrl = sanitizeShareUrl(url);
  const tw = (triggerWarning || '').trim();

  // Budget the warning against what the url actually leaves, not just its own
  // cap: the url is the one part never shortened (a broken link is worse than
  // no link), so with a pathologically long one the warning has to give. A
  // message over the limit is rejected by Twitch outright, which would lose
  // the warning entirely rather than merely trim it.
  let suffix = '';
  if (tw) {
    const budget = Math.min(MAX_TW_CHARS, MAX_CHARS - `Watching: ${shareUrl}`.length - 1 - TW_PREFIX.length);
    if (budget > 0) suffix = ` ${TW_PREFIX}${ellipsize(tw, budget)}`;
  }

  let t = title || shareUrl;
  const fixed = `Watching:  ${shareUrl}`.length + suffix.length; // "Watching: " + space + url + warning
  if (fixed + t.length > MAX_CHARS) {
    const room = MAX_CHARS - fixed - 1;
    // With a long url and a warning there can be no room left at all; drop
    // the title rather than emit a bare "…" that says nothing.
    t = room > 0 ? t.slice(0, room) + '…' : '';
  }
  return t ? `Watching: ${t} ${shareUrl}${suffix}` : `Watching: ${shareUrl}${suffix}`;
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
  sub: { title: string | null; url: string; trigger_warning?: string | null },
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

  const message = buildWatchingMessage(sub.title, sub.url, sub.trigger_warning);
  const result = await sendChatMessage(accessToken, broadcasterTwitchUserId, senderTwitchUserId, message);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, message };
}
