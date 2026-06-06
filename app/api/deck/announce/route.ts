import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { refreshAccessToken, sendChatMessage } from '@/lib/twitch-oauth';

const MAX_CHARS = 500;

// Post a "Watching: <title> <url>" message to the streamer's own chat.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'streamer') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('twitch_user_id, access_token, refresh_token, token_expires_at, now_playing_id')
    .eq('id', session.streamId)
    .single();

  if (!stream?.access_token || !stream?.refresh_token) {
    return NextResponse.json(
      { error: 'reconnect', detail: 'Chat posting needs reauthorization — sign out and back in.' },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const subId = body.id ? String(body.id) : stream.now_playing_id;
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

  // Refresh the token if it's expired or about to be.
  let accessToken = stream.access_token;
  const expMs = stream.token_expires_at ? new Date(stream.token_expires_at).getTime() : 0;
  if (expMs < Date.now() + 60_000) {
    const refreshed = await refreshAccessToken(stream.refresh_token);
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
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      })
      .eq('id', session.streamId);
  }

  // Build the message, truncating the title if needed to fit Twitch's limit.
  let title = sub.title || sub.url;
  const fixed = `Watching:  ${sub.url}`.length; // "Watching: " + space + url
  if (fixed + title.length > MAX_CHARS) {
    const room = Math.max(0, MAX_CHARS - fixed - 1);
    title = title.slice(0, room) + '…';
  }
  const message = `Watching: ${title} ${sub.url}`;

  const result = await sendChatMessage(
    accessToken,
    stream.twitch_user_id,
    stream.twitch_user_id,
    message,
  );
  if (!result.ok) {
    return NextResponse.json({ error: 'send failed', detail: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true, message });
}
