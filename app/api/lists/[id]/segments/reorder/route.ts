import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';

// POST — reorder a shelf's blocks (list segments + the ungrouped sentinel).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { ids } = await req.json().catch(() => ({ ids: [] }));
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'missing ids array' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: list } = await sb
    .from('lists')
    .select('id')
    .eq('id', params.id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!list) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await Promise.all(
    ids.map((id: string, i: number) => {
      if (id === 'ungrouped') {
        return sb.from('lists').update({ ungrouped_position: i + 1 }).eq('id', list.id);
      }
      return sb.from('list_segments').update({ position: i + 1 }).eq('id', id).eq('list_id', list.id);
    }),
  );

  return NextResponse.json({ ok: true });
}
