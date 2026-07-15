import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession, getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';

export const dynamic = 'force-dynamic';

// GET — list this stream's shelf, newest-position-first, with item counts.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sb = supabaseAdmin();
  const { data: lists, error } = await sb
    .from('lists')
    .select('id, name, position, share_token, created_at, updated_at')
    .eq('stream_id', session.streamId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  // Degrade gracefully if the migration hasn't been run yet.
  if (error) return NextResponse.json({ lists: [] });

  const ids = (lists || []).map((l) => l.id);
  const counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: items } = await sb.from('list_items').select('list_id').in('list_id', ids);
    for (const it of items || []) {
      counts[it.list_id] = (counts[it.list_id] || 0) + 1;
    }
  }

  return NextResponse.json({
    lists: (lists || []).map((l) => ({ ...l, item_count: counts[l.id] || 0 })),
  });
}

// POST — create a shelf, appended to the top (newest-first, matching segments).
export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name = (typeof body.name === 'string' && body.name.trim()) || 'New shelf';

  const sb = supabaseAdmin();
  const { data: first } = await sb
    .from('lists')
    .select('position')
    .eq('stream_id', session.streamId)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  const position = (first?.position ?? 0) - 1;

  const { data, error } = await sb
    .from('lists')
    .insert({ stream_id: session.streamId, name, position })
    .select('id, name, position, share_token, created_at, updated_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ list: { ...data, item_count: 0 } });
}
