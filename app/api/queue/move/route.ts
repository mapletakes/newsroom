import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';
import { broadcastQueueChange } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

// Move one or more items into a block (a segment id, or null for ungrouped) and
// set the full ordering of that block in a single shot. `ids` are the items
// being moved; `orderedIds` is the complete final order of the target block
// (existing items + moved items), used to renumber positions 1..N.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const orderedIds: string[] = Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : [];
  const segmentId: string | null = body.segmentId == null ? null : String(body.segmentId);
  if (ids.length === 0) return NextResponse.json({ error: 'missing ids' }, { status: 400 });

  const sb = supabaseAdmin();

  // Reassign the moved items to the target block.
  await sb
    .from('submissions')
    .update({ segment_id: segmentId })
    .in('id', ids)
    .eq('stream_id', session.streamId);

  // Renumber positions across the target block so the moved group lands where
  // it was dropped.
  await Promise.all(
    orderedIds.map((id, i) =>
      sb.from('submissions').update({ position: i + 1 }).eq('id', id).eq('stream_id', session.streamId),
    ),
  );

  broadcastQueueChange(session.streamId);
  return NextResponse.json({ ok: true });
}
