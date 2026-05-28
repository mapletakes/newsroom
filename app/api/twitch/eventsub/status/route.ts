// Check and manage EventSub subscription status for the logged-in streamer.

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { listSubscriptions, createChatSubscription } from '@/lib/twitch-eventsub';

/** GET — return the subscription status for this streamer's channel. */
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'streamer') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('twitch_user_id')
    .eq('id', session.streamId)
    .single();
  if (!stream) return NextResponse.json({ error: 'stream not found' }, { status: 404 });

  try {
    const subs = await listSubscriptions('channel.chat.message');
    const mine = subs.filter(
      (s: { condition: { broadcaster_user_id: string }; status: string }) =>
        s.condition.broadcaster_user_id === stream.twitch_user_id,
    );

    const active = mine.find((s: { status: string }) => s.status === 'enabled');

    return NextResponse.json({
      connected: !!active,
      status: active?.status || (mine[0]?.status ?? 'none'),
      subscriptionCount: mine.length,
    });
  } catch (err) {
    console.error('EventSub status check failed:', err);
    return NextResponse.json({ connected: false, status: 'error' });
  }
}

/** POST — create (or re-create) the EventSub subscription. */
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== 'streamer') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('twitch_user_id')
    .eq('id', session.streamId)
    .single();
  if (!stream) return NextResponse.json({ error: 'stream not found' }, { status: 404 });

  try {
    const id = await createChatSubscription(stream.twitch_user_id);
    return NextResponse.json({ ok: !!id, subscriptionId: id });
  } catch (err) {
    console.error('EventSub reconnect failed:', err);
    return NextResponse.json({ error: 'failed to create subscription' }, { status: 500 });
  }
}
