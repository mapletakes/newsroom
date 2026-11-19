import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { isAdmin } from '@/lib/admin';
import { logAdminAction } from '@/lib/audit';
import { flagStatus } from '@/lib/chatter-flags';
import { MAX_REMOVAL_REASON, type AdminFlag, type FlagMessage } from '@/lib/chatter-flag-types';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON = MAX_REMOVAL_REASON;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function requireAdmin() {
  const session = await getSession();
  return session && isAdmin(session.twitchUserId) ? session : null;
}

// Every flag a channel has made, including withdrawn and removed ones.
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return json({ error: 'forbidden' }, 403);
  const streamId = req.nextUrl.searchParams.get('streamId') ?? '';
  if (!UUID.test(streamId)) return json({ error: 'invalid streamId' }, 400);

  const { data, error } = await supabaseAdmin()
    .from('chatter_flags')
    .select(
      'id, chatter_login, chatter_name, category, context, created_by_login, created_at, withdrawn_at, expires_at, ' +
        'removed_at, removed_by_login, removed_reason, ' +
        'chatter_flag_messages(suspicious_messages(id, sent_at, message_text, low_trust_status))',
    )
    .eq('stream_id', streamId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return json({ error: error.message }, 500);

  type Row = Omit<AdminFlag, 'status' | 'messages'> & {
    withdrawn_at: string | null;
    expires_at: string;
    removed_at: string | null;
    chatter_flag_messages: { suspicious_messages: FlagMessage | null }[] | null;
  };
  const now = Date.now();
  const flags: AdminFlag[] = ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    chatter_login: row.chatter_login,
    chatter_name: row.chatter_name,
    category: row.category,
    context: row.context,
    created_by_login: row.created_by_login,
    created_at: row.created_at,
    status: flagStatus(row, now),
    removed_by_login: row.removed_by_login,
    removed_reason: row.removed_reason,
    messages: (row.chatter_flag_messages ?? [])
      .map((link) => link.suspicious_messages)
      .filter((m): m is FlagMessage => !!m)
      .sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at)),
  }));
  return json({ flags });
}

// Takes a flag down (every channel stops seeing it, and its own channel sees
// that it was removed and why) or puts a removed one back.
export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return json({ error: 'forbidden' }, 403);

  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === 'string' && UUID.test(body.id) ? body.id : '';
  const action = body.action;
  if (!id || (action !== 'remove' && action !== 'restore')) return json({ error: 'invalid request' }, 400);
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (action === 'remove' && (!reason || reason.length > MAX_REASON)) {
    return json({ error: `A reason of up to ${MAX_REASON} characters is required.` }, 400);
  }

  const sb = supabaseAdmin();
  const patch =
    action === 'remove'
      ? { removed_at: new Date().toISOString(), removed_by_login: session.twitchLogin ?? '', removed_reason: reason }
      : { removed_at: null, removed_by_login: null, removed_reason: null };
  let query = sb.from('chatter_flags').update(patch).eq('id', id);
  query = action === 'remove' ? query.is('removed_at', null) : query.not('removed_at', 'is', null);

  const { data, error } = await query.select('id, stream_id, chatter_login');
  if (error?.code === '23505') {
    // Restoring would give the channel two live flags on the same chatter.
    return json({ error: 'That channel has flagged this chatter again since; restore isn’t possible.' }, 409);
  }
  if (error) return json({ error: error.message }, 500);
  const flag = data?.[0];
  if (!flag) return json({ error: 'not found' }, 404);

  await logAdminAction(sb, session, action === 'remove' ? 'remove_flag' : 'restore_flag', flag.stream_id, {
    chatter: flag.chatter_login,
    ...(action === 'remove' ? { reason } : {}),
  });
  return json({ ok: true });
}
