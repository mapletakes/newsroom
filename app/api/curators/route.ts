import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Streamer toggles a mod's deck permissions: can_curate (organize — segments,
// reorder, add links) and can_set_now_playing (put an approved item on air —
// narrower, and only meaningful alongside can_curate, since a mod without it
// can never reach the deck at all). Only patches whichever field is present
// in the body, not both unconditionally — the Curators UI sends them
// independently (e.g. toggling can_set_now_playing alone shouldn't touch
// can_curate), and always coercing an absent field to false would silently
// clobber the other permission on every call.
export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session || session.role !== 'streamer') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const twitchUserId = String(body.twitchUserId || '');
  if (!twitchUserId) {
    return NextResponse.json({ error: 'missing twitchUserId' }, { status: 400 });
  }

  const patch: Record<string, boolean> = {};
  if (typeof body.canCurate === 'boolean') patch.can_curate = body.canCurate;
  if (typeof body.canSetNowPlaying === 'boolean') patch.can_set_now_playing = body.canSetNowPlaying;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from('moderators')
    .update(patch)
    .eq('stream_id', session.streamId)
    .eq('twitch_user_id', twitchUserId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, ...body });
}
