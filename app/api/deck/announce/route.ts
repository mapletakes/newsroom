import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { announceSubmission } from '@/lib/announce';
import { resolveTitle } from '@/lib/title-override';

// Post "Watching: <title> <url>" to the channel's chat, as the logged-in
// user (streamer or mod) using their own stored token.
export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Posting to chat needs a linked Twitch identity (and its stored token).
  if (!session.twitchUserId) {
    return NextResponse.json({ error: 'no-twitch', detail: 'Connect Twitch to post to chat.' }, { status: 409 });
  }
  const twitchUserId = session.twitchUserId;

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
    .select('id')
    .eq('twitch_user_id', twitchUserId)
    .maybeSingle();
  if (!sender) {
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
  const pin = !!body.pin;

  const { data: sub } = await sb
    .from('submissions')
    .select('title, title_override, url, trigger_warning')
    .eq('id', subId)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: 'submission not found' }, { status: 404 });

  // The streamer's override (if any) replaces the scraped title in the post,
  // same as on the overlay.
  const result = await announceSubmission(
    sender.id,
    channel.twitch_user_id,
    twitchUserId,
    { title: resolveTitle(sub), url: sub.url, trigger_warning: sub.trigger_warning },
    pin,
  );
  if (!result.ok) {
    if (result.error === 'reconnect') {
      return NextResponse.json(
        { error: 'reconnect', detail: 'Chat posting needs reauthorization — sign out and back in.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'send failed', detail: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true, message: result.message });
}
