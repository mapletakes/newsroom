import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { isAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

// Enable/disable the Questions feature for a channel. Super-admin only — see
// schema.sql on streams.questions_enabled for why this is opt-in per account
// rather than a setting the streamer can flip themselves.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session.twitchUserId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const streamId = String(body.streamId || '');
  const enabled = !!body.enabled;
  if (!streamId) return NextResponse.json({ error: 'missing streamId' }, { status: 400 });

  const sb = supabaseAdmin();
  const { error } = await sb.from('streams').update({ questions_enabled: enabled }).eq('id', streamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, enabled });
}
