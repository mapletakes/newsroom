import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { broadcastQueueChange } from '@/lib/realtime';

// The streamer's deck reports which approved item it's currently showing so
// the mod view can display what's on air.
export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session || session.role !== 'streamer') {
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
