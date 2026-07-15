import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';

// PATCH — edit an item's curator note.
export async function PATCH(req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.note !== 'string' && body.note !== null) {
    return NextResponse.json({ error: 'missing note' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: list } = await sb
    .from('lists')
    .select('id')
    .eq('id', params.id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!list) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { error } = await sb
    .from('list_items')
    .update({ note: body.note })
    .eq('id', params.itemId)
    .eq('list_id', list.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE — remove one item from a shelf.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data: list } = await sb
    .from('lists')
    .select('id')
    .eq('id', params.id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!list) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { error } = await sb
    .from('list_items')
    .delete()
    .eq('id', params.itemId)
    .eq('list_id', list.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
