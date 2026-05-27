import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { ids } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'missing ids array' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  await Promise.all(
    ids.map((id: string, i: number) =>
      sb.from('submissions')
        .update({ position: i + 1 })
        .eq('id', id)
        .eq('stream_id', session.streamId)
    ),
  );

  return NextResponse.json({ ok: true });
}
