import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sessionCanSetNowPlaying } from '@/lib/curate';
import { broadcastQueueChange } from '@/lib/realtime';

// The deck reports which approved item it's currently showing so the mod
// view/overlay can display what's on air. Open to the streamer and, since a
// mod may be granted can_set_now_playing (correcting a misclick or forgotten
// advance), to those mods too — enforced here, not just by the client
// suppressing the request for mods without it.
export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session || !(await sessionCanSetNowPlaying(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const id = body.id ? String(body.id) : null;

  const sb = supabaseAdmin();
  const { error } = await sb
    .from('streams')
    .update({ now_playing_id: id })
    .eq('id', session.streamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  broadcastQueueChange(session.streamId);
  return NextResponse.json({ ok: true });
}
