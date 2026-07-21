import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';

export const dynamic = 'force-dynamic';

// POST — create a list segment, appended above everything (including the
// ungrouped block) — same convention as the deck's segments.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data: list } = await sb
    .from('lists')
    .select('id, ungrouped_position')
    .eq('id', params.id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!list) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const name = (typeof body.name === 'string' && body.name.trim()) || 'New segment';

  const { data: first } = await sb
    .from('list_segments')
    .select('position')
    .eq('list_id', list.id)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  const candidates: number[] = [list.ungrouped_position ?? 0];
  if (first?.position != null) candidates.push(first.position);
  const position = Math.min(...candidates) - 1;

  const { data, error } = await sb
    .from('list_segments')
    .insert({ list_id: list.id, name, position })
    .select('id, name, position')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ segment: data });
}

// PATCH — rename or reposition a list segment.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') patch.name = body.name.slice(0, 80) || 'Segment';
  if (typeof body.position === 'number') patch.position = body.position;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: list } = await sb
    .from('lists')
    .select('id')
    .eq('id', params.id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!list) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { error } = await sb
    .from('list_segments')
    .update(patch)
    .eq('id', id)
    .eq('list_id', list.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE — remove a list segment. Its items fall back to ungrouped (FK SET NULL).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: list } = await sb
    .from('lists')
    .select('id')
    .eq('id', params.id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!list) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { error } = await sb
    .from('list_segments')
    .delete()
    .eq('id', id)
    .eq('list_id', list.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
