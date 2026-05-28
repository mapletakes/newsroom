import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { broadcastQueueChange } from '@/lib/realtime';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sb = supabaseAdmin();
  const { error } = await sb
    .from('submissions')
    .update({ status: 'rejected' })
    .eq('stream_id', session.streamId)
    .eq('status', 'pending');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  broadcastQueueChange(session.streamId);
  return NextResponse.json({ ok: true });
}
