import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Generate (or regenerate) the streamer's personal quick-add token.
export async function POST() {
  const session = await getApprovedSession();
  if (!session || session.role !== 'streamer') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const token = 'nr_' + crypto.randomBytes(24).toString('hex');
  const sb = supabaseAdmin();
  const { error } = await sb
    .from('streams')
    .update({ add_token: token })
    .eq('id', session.streamId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ token });
}
