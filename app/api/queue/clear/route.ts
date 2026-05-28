import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sb = supabaseAdmin();
  const { error } = await sb
    .from('submissions')
    .update({ status: 'rejected' })
    .eq('stream_id', session.streamId)
    .eq('status', 'pending');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
