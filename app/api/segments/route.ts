import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { broadcastQueueChange } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

// GET — list this stream's segments in display order.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('segments')
    .select('id, name, position, collapsed')
    .eq('stream_id', session.streamId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  // Degrade gracefully if the migration hasn't been run yet.
  if (error) return NextResponse.json({ segments: [] });
  return NextResponse.json({ segments: data || [] });
}

// POST — create a segment, appended to the end.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = (typeof body.name === 'string' && body.name.trim()) || 'New segment';

  const sb = supabaseAdmin();
  const { data: last } = await sb
    .from('segments')
    .select('position')
    .eq('stream_id', session.streamId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (last?.position ?? 0) + 1;

  const { data, error } = await sb
    .from('segments')
    .insert({ stream_id: session.streamId, name, position })
    .select('id, name, position, collapsed')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  broadcastQueueChange(session.streamId);
  return NextResponse.json({ segment: data });
}

// PATCH — rename, collapse/expand, or reposition a segment.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json();
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') patch.name = body.name.slice(0, 80) || 'Segment';
  if (typeof body.collapsed === 'boolean') patch.collapsed = body.collapsed;
  if (typeof body.position === 'number') patch.position = body.position;

  const sb = supabaseAdmin();
  const { error } = await sb
    .from('segments')
    .update(patch)
    .eq('id', id)
    .eq('stream_id', session.streamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  broadcastQueueChange(session.streamId);
  return NextResponse.json({ ok: true });
}

// DELETE — remove a segment. Its items fall back to ungrouped (FK SET NULL).
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json();
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const sb = supabaseAdmin();
  const { error } = await sb
    .from('segments')
    .delete()
    .eq('id', id)
    .eq('stream_id', session.streamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  broadcastQueueChange(session.streamId);
  return NextResponse.json({ ok: true });
}
