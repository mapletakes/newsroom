import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { refreshAccessToken, sendChatMessage } from '@/lib/twitch-oauth';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { sanitizeShareUrl } from '@/lib/url';

const MAX_CHARS = 500;

// Post "Watching: <title> <url>" to the channel's chat, as the logged-in
// user (streamer or mod) using their own stored token.
export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const sb = supabaseAdmin();

  // The channel we're posting to (the broadcaster).
  const { data: channel } = await sb
    .from('streams')
    .select('twitch_user_id, now_playing_id')
    .eq('id', session.streamId)
    .single();
  if (!channel) return NextResponse.json({ error: 'stream not found' }, { status: 404 });

  // The sender = the logged-in user, posting from their own account. Their
  // tokens live on their own stream row (keyed by their twitch_user_id).
  const { data: sender } = await sb
    .from('streams')
    .select('id, access_token, refresh_token, token_expires_at')
    .eq('twitch_user_id', session.twitchUserId)
    .maybeSingle();
  const storedAccess = decryptSecret(sender?.access_token);
  const storedRefresh = decryptSecret(sender?.refresh_token);
  if (!sender || !storedAccess || !storedRefresh) {
    return NextResponse.json(
      { error: 'reconnect', detail: 'Chat posting needs reauthorization — sign out and back in.' },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const subId = body.id ? String(body.id) : channel.now_playing_id;
  if (!subId) {
    return NextResponse.json({ error: 'nothing to announce' }, { status: 400 });
  }

  const { data: sub } = await sb
    .from('submissions')
    .select('title, url')
    .eq('id', subId)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: 'submission not found' }, { status: 404 });

  // Refresh the sender's token if it's expired or about to be.
  let accessToken = storedAccess;
  const expMs = sender.token_expires_at ? new Date(sender.token_expires_at).getTime() : 0;
  if (expMs < Date.now() + 60_000) {
    const refreshed = await refreshAccessToken(storedRefresh);
    if (!refreshed) {
      return NextResponse.json(
        { error: 'reconnect', detail: 'Chat token expired — sign out and back in.' },
        { status: 400 },
      );
    }
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

  // Build the message, truncating the title if needed to fit Twitch's limit.
  // Strip playlist params so an unlisted playlist id is never posted publicly.
  const shareUrl = sanitizeShareUrl(sub.url);
  let title = sub.title || shareUrl;
  const fixed = `Watching:  ${shareUrl}`.length; // "Watching: " + space + url
  if (fixed + title.length > MAX_CHARS) {
    const room = Math.max(0, MAX_CHARS - fixed - 1);
    title = title.slice(0, room) + '…';
  }
  const message = `Watching: ${title} ${shareUrl}`;

  const result = await sendChatMessage(
    accessToken,
    channel.twitch_user_id, // broadcaster (channel)
    session.twitchUserId, // sender (this user)
    message,
  );
  if (!result.ok) {
    return NextResponse.json({ error: 'send failed', detail: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true, message });
}
