import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSuspiciousLogAccess } from '@/lib/suspicious-log-access';
import { denied, reply } from '@/lib/suspicious-log-http';
import { escapeLike, type ChattersResponse } from '@/lib/suspicious-log-query';

export const dynamic = 'force-dynamic';

// The chatters a channel's log has seen, most recently active first, for the
// page's picker. PostgREST can't group rows, so this takes the newest matching
// messages and keeps each chatter's latest. A channel's flagged chatters are
// few, so a window this size reaches back a long way; it avoids a database
// function for a lookup that only feeds a dropdown.
const SCAN_LIMIT = 2000;
const RESULT_LIMIT = 25;

export async function GET(req: NextRequest) {
  const access = await getSuspiciousLogAccess();
  if (!access.ok) return denied(access.reason);

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().replace(/^@/, '').toLowerCase().slice(0, 40);

  let query = supabaseAdmin()
    .from('suspicious_messages')
    .select('chatter_user_id, chatter_login, chatter_name, low_trust_status, sent_at')
    .eq('stream_id', access.streamId);
  if (q) query = query.ilike('chatter_login', `%${escapeLike(q)}%`);

  const { data, error } = await query.order('sent_at', { ascending: false }).limit(SCAN_LIMIT);
  if (error) {
    console.error('suspicious-log: chatter lookup failed:', error.message);
    return reply({ error: 'could not load chatters' }, 500);
  }

  // Newest first, so a chatter's first row here is their latest message.
  const seen = new Set<string>();
  const chatters: ChattersResponse['chatters'] = [];
  for (const row of data ?? []) {
    if (seen.has(row.chatter_user_id)) continue;
    seen.add(row.chatter_user_id);
    chatters.push({
      id: row.chatter_user_id,
      login: row.chatter_login,
      name: row.chatter_name,
      status: row.low_trust_status,
      last_seen: row.sent_at,
    });
    if (chatters.length >= RESULT_LIMIT) break;
  }

  return reply({ chatters } satisfies ChattersResponse);
}
