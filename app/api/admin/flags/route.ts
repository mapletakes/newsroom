import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { isAdmin, isChannelModuleKey } from '@/lib/admin';
import { logAdminAction } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Enable/disable an opt-in module (lib/admin.ts CHANNEL_MODULES) for a
// channel. Super-admin only. Replaces one route per module — see
// CHANNEL_MODULES' doc comment for why. `flag` is checked against that
// registry rather than trusted from the body: it lands directly in an
// update() column name below.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session.twitchUserId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const streamId = String(body.streamId || '');
  const flag = String(body.flag || '');
  const enabled = !!body.enabled;
  if (!streamId) return NextResponse.json({ error: 'missing streamId' }, { status: 400 });
  if (!isChannelModuleKey(flag)) return NextResponse.json({ error: 'unknown flag' }, { status: 400 });

  const sb = supabaseAdmin();
  const { error } = await sb.from('streams').update({ [flag]: enabled }).eq('id', streamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logAdminAction(sb, session, 'flag', streamId, { flag, enabled });
  return NextResponse.json({ ok: true, flag, enabled });
}
