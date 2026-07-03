import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';
import { broadcastQueueChange } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

// Reject every approved item in one deck block (a segment, or 'ungrouped').
export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const containerId = String(body.containerId || '');
  if (!containerId) return NextResponse.json({ error: 'missing containerId' }, { status: 400 });

  const sb = supabaseAdmin();
  let q = sb
    .from('submissions')
    .update({ status: 'rejected' })
    .eq('stream_id', session.streamId)
    .eq('status', 'approved');
  q = containerId === 'ungrouped' ? q.is('segment_id', null) : q.eq('segment_id', containerId);
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  broadcastQueueChange(session.streamId);
  return NextResponse.json({ ok: true });
}
