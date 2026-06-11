import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { isAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

// Block/unblock a channel (toggle streams.approved).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session.twitchUserId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const streamId = String(body.streamId || '');
  const approved = !!body.approved;
  if (!streamId) return NextResponse.json({ error: 'missing streamId' }, { status: 400 });

  const sb = supabaseAdmin();
  const { error } = await sb.from('streams').update({ approved }).eq('id', streamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, approved });
}
