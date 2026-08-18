import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';

export const dynamic = 'force-dynamic';

// Move a shelf item into a block (a list segment id, or null for ungrouped)
// and set the full ordering of that block in one shot. Mirrors
// /api/queue/move — `ids` are the items being moved, `orderedIds` is the
// complete final order of the target block, used to renumber positions 1..N.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getApprovedSession();
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
  const { data: list } = await sb
    .from('lists')
    .select('id')
    .eq('id', id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!list) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await sb
    .from('list_items')
    .update({ segment_id: segmentId })
    .in('id', ids)
    .eq('list_id', list.id);

  await Promise.all(
    orderedIds.map((id, i) =>
      sb.from('list_items').update({ position: i + 1 }).eq('id', id).eq('list_id', list.id),
    ),
  );

  return NextResponse.json({ ok: true });
}
