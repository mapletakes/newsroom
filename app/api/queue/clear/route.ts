import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { broadcastQueueChange } from '@/lib/realtime';

// Only these statuses can be bulk-cleared. Approved is protected (it's the
// live streamer deck). Played submissions can be cleared — the show-notes
// export lives in a separate table and is preserved.
const CLEARABLE = new Set(['pending', 'rejected', 'played']);

export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
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
