import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { isAdmin } from '@/lib/admin';
import { logAdminAction } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Bulk-reject a channel's entire pending queue. Sets status to 'rejected'
// rather than deleting: deleting would silently distort this channel's own
// lifetime totals and the admin dashboard's cost estimate, and there'd be no
// way to tell "never used" from "an admin cleared it". Super-admin only.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session.twitchUserId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const streamId = String(body.streamId || '');
  if (!streamId) return NextResponse.json({ error: 'missing streamId' }, { status: 400 });

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('submissions')
    .update({ status: 'rejected' })
    .eq('stream_id', streamId)
    .eq('status', 'pending')
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const count = data?.length ?? 0;
  await logAdminAction(sb, session, 'clear_pending', streamId, { count });
  return NextResponse.json({ ok: true, count });
}
