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

  // Pre-flight: check required env vars
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_APP_URL) missing.push('NEXT_PUBLIC_APP_URL');
  if (!process.env.EVENTSUB_SECRET) missing.push('EVENTSUB_SECRET');
  if (!process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID) missing.push('NEXT_PUBLIC_TWITCH_CLIENT_ID');
  if (!process.env.TWITCH_CLIENT_SECRET) missing.push('TWITCH_CLIENT_SECRET');
  if (missing.length > 0) {
    return NextResponse.json({
      ok: false,
      error: `Missing env vars: ${missing.join(', ')}`,
      callbackUrl: null,
    });
  }

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('twitch_user_id')
    .eq('id', session.streamId)
    .single();
  if (!stream) return NextResponse.json({ error: 'stream not found' }, { status: 404 });

  const callbackUrl = `${(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')}/api/twitch/eventsub`;

  try {
    const id = await createChatSubscription(stream.twitch_user_id);
    return NextResponse.json({
      ok: !!id,
      subscriptionId: id,
      callbackUrl,
      twitchUserId: stream.twitch_user_id,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('EventSub reconnect failed:', message);
    return NextResponse.json({
      ok: false,
      error: message,
      callbackUrl,
      twitchUserId: stream.twitch_user_id,
    });
  }
}
