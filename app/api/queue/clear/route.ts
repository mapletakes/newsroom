import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { broadcastQueueChange } from '@/lib/realtime';

// Only these statuses can be bulk-cleared. Approved/played are protected
// (they're the streamer deck and show-notes history).
const CLEARABLE = new Set(['pending', 'rejected']);

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  // Default to clearing pending (backward compatible). Pass { status: 'rejected' }
  // to purge rejected links instead.
  let status = 'pending';
  try {
    const body = await req.json();
    if (body && typeof body.status === 'string') status = body.status;
  } catch {
    /* no body — keep default */
  }

  if (!CLEARABLE.has(status)) {
    return NextResponse.json({ error: 'can only clear pending or rejected' }, { status: 400 });
  }

  // Permanently remove so the queue doesn't accumulate hundreds of dead links.
  const sb = supabaseAdmin();
  const { error } = await sb
    .from('submissions')
    .delete()
    .eq('stream_id', session.streamId)
    .eq('status', status);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  broadcastQueueChange(session.streamId);
  return NextResponse.json({ ok: true });
}
