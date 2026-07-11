import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';

export async function POST(req: NextRequest) {
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
  await Promise.all(
    ids.map((id: string, i: number) =>
      sb.from('lists').update({ position: i + 1 }).eq('id', id).eq('stream_id', session.streamId),
    ),
  );

  return NextResponse.json({ ok: true });
}
