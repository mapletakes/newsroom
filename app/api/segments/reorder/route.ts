import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { broadcastQueueChange } from '@/lib/realtime';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { ids } = await req.json();
  if (!Array.isArray(ids)) {
    return NextResponse.json({ error: 'missing ids array' }, { status: 400 });
  }

  // The ungrouped block participates in ordering via a sentinel id so
  // segments can be moved above or below it.
  const sb = supabaseAdmin();
  await Promise.all(
    ids.map((id: string, i: number) => {
      if (id === 'ungrouped') {
        return sb.from('streams')
          .update({ ungrouped_position: i + 1 })
          .eq('id', session.streamId);
      }
      return sb.from('segments')
        .update({ position: i + 1 })
        .eq('id', id)
        .eq('stream_id', session.streamId);
    }),
  );

  broadcastQueueChange(session.streamId);
  return NextResponse.json({ ok: true });
}
