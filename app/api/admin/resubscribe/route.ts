import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { isAdmin } from '@/lib/admin';
import { createChatSubscription } from '@/lib/twitch-eventsub';

export const dynamic = 'force-dynamic';

// (Re)create the chat EventSub subscription for a channel.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session.twitchUserId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const streamId = String(body.streamId || '');
  if (!streamId) return NextResponse.json({ error: 'missing streamId' }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('twitch_user_id')
    .eq('id', streamId)
    .maybeSingle();
  if (!stream) return NextResponse.json({ error: 'stream not found' }, { status: 404 });

  try {
    const id = await createChatSubscription(stream.twitch_user_id);
    return NextResponse.json({ ok: !!id, subscriptionId: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
