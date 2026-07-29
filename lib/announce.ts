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
const TW_SEP = ' — ';

function ellipsize(s: string, max: number): string {
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + '…' : s;
}

// Builds "⚠ TW: <warning> — Watching: <title> <url>", dropping the warning
// clause when the item doesn't carry one. Truncates the title (never the url,
// never the warning's prefix) to fit Twitch's message limit, and strips
// playlist params so an unlisted playlist id is never posted publicly.
export function buildWatchingMessage(
  title: string | null,
  url: string,
  triggerWarning?: string | null,
): string {
  const shareUrl = sanitizeShareUrl(url);
  const tw = (triggerWarning || '').trim();

  // The warning LEADS the message rather than trailing it: Twitch's pinned
  // banner and its notification previews show only the opening characters, so
  // a warning after the url is precisely the part that gets cut off — and a
  // viewer could click through before ever seeing it.
  //
  // Budgeted against what the url actually leaves, not just its own cap: the
  // url is the one part never shortened (a broken link is worse than no
  // link), so a pathologically long one forces the warning to give. An
  // over-limit message is rejected by Twitch outright, which would lose the
  // warning entirely rather than merely trim it.
  let prefix = '';
  if (tw) {
    const core = `Watching: ${shareUrl}`.length + TW_PREFIX.length + TW_SEP.length;
    const budget = Math.min(MAX_TW_CHARS, MAX_CHARS - core);
    if (budget > 0) prefix = `${TW_PREFIX}${ellipsize(tw, budget)}${TW_SEP}`;
  }

  let t = title || shareUrl;
  const fixed = prefix.length + `Watching:  ${shareUrl}`.length; // warning + "Watching: " + space + url
  if (fixed + t.length > MAX_CHARS) {
    const room = MAX_CHARS - fixed - 1;
    // With a long url and a warning there can be no room left at all; drop
    // the title rather than emit a bare "…" that says nothing.
    t = room > 0 ? t.slice(0, room) + '…' : '';
  }
  return t ? `${prefix}Watching: ${t} ${shareUrl}` : `${prefix}Watching: ${shareUrl}`;
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
