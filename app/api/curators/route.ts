import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Streamer toggles whether one of their mods may curate the deck.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'streamer') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const twitchUserId = String(body.twitchUserId || '');
  const canCurate = !!body.canCurate;
  if (!twitchUserId) {
    return NextResponse.json({ error: 'missing twitchUserId' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from('moderators')
    .update({ can_curate: canCurate })
    .eq('stream_id', session.streamId)
    .eq('twitch_user_id', twitchUserId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, canCurate });
}
