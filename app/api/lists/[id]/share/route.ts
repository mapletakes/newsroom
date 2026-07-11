import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';

// POST — generate a share link for this clip file (idempotent: returns the
// existing token if one's already set, so re-clicking "Share" in the UI
// doesn't invalidate a link someone already sent out). Pass
// { regenerate: true } to force a fresh token, revoking the old link.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const sb = supabaseAdmin();
  const { data: list } = await sb
    .from('lists')
    .select('id, share_token')
    .eq('id', params.id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!list) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (list.share_token && !body.regenerate) {
    return NextResponse.json({ token: list.share_token });
  }

  const token = 'cf_' + crypto.randomBytes(24).toString('hex');
  const { error } = await sb.from('lists').update({ share_token: token }).eq('id', list.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ token });
}

// DELETE — revoke the share link.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from('lists')
    .update({ share_token: null })
    .eq('id', params.id)
    .eq('stream_id', session.streamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
