import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession, getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';

export const dynamic = 'force-dynamic';

// GET — one list plus its items, in display order.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sb = supabaseAdmin();
  const { data: list, error } = await sb
    .from('lists')
    .select('id, name, position, share_token, created_at, updated_at')
    .eq('id', params.id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (error || !list) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: items } = await sb
    .from('list_items')
    .select('*')
    .eq('list_id', list.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  return NextResponse.json({ list, items: items || [] });
}

// PATCH — rename a shelf.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') patch.name = body.name.slice(0, 80) || 'Shelf';
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  patch.updated_at = new Date().toISOString();

  const sb = supabaseAdmin();
  const { error } = await sb
    .from('lists')
    .update(patch)
    .eq('id', params.id)
    .eq('stream_id', session.streamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE — remove a shelf (items cascade).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from('lists')
    .delete()
    .eq('id', params.id)
    .eq('stream_id', session.streamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
