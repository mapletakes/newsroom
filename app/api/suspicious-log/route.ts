import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSuspiciousLogAccess, type LogDenied } from '@/lib/suspicious-log-access';
import {
  LOG_PAGE_SIZE,
  MAX_DELETE_IDS,
  escapeLike,
  parseLogFilters,
  type LogResponse,
} from '@/lib/suspicious-log-query';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_HISTORY_LIMIT = 50;
const NO_STORE = { 'Cache-Control': 'no-store' };

const DENIED_STATUS: Record<LogDenied, number> = {
  unauthenticated: 401,
  forbidden: 403,
  reconnect: 403,
  twitch: 503,
};

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const denied = (reason: LogDenied) => reply({ error: reason }, DENIED_STATUS[reason]);

// One page of a channel's log, newest first. Filtering happens in the database
// because a year of messages is too much to send to the browser.
export async function GET(req: NextRequest) {
  const access = await getSuspiciousLogAccess();
  if (!access.ok) return denied(access.reason);

  const filters = parseLogFilters(req.nextUrl.searchParams);
  const sb = supabaseAdmin();

  let query = sb
    .from('suspicious_messages')
    .select(
      'id, chatter_user_id, chatter_login, chatter_name, message_text, low_trust_status, detection_types, ban_evasion_evaluation, shared_ban_channel_ids, sent_at',
      { count: 'exact' },
    )
    .eq('stream_id', access.streamId);

  if (filters.q) query = query.ilike('message_text', `%${escapeLike(filters.q)}%`);
  if (filters.user) query = query.ilike('chatter_login', `${escapeLike(filters.user)}%`);
  if (filters.chatterId) query = query.eq('chatter_user_id', filters.chatterId);
  if (filters.status === 'restricted') query = query.eq('low_trust_status', 'restricted');
  if (filters.status === 'other') query = query.neq('low_trust_status', 'restricted');
  if (filters.type) query = query.contains('detection_types', [filters.type]);
  if (filters.from) query = query.gte('sent_at', filters.from);
  if (filters.to) query = query.lt('sent_at', filters.to);

  const start = (filters.page - 1) * LOG_PAGE_SIZE;
  const { data, error, count } = await query
    .order('sent_at', { ascending: false })
    .order('id', { ascending: false })
    .range(start, start + LOG_PAGE_SIZE - 1);

  // PGRST103 is a page past the end, which deleting the last rows can cause.
  if (error && error.code !== 'PGRST103') {
    console.error('suspicious-log: list failed:', error.message);
    return reply({ error: 'could not load the log' }, 500);
  }

  let statusChanges: LogResponse['statusChanges'] = [];
  if (filters.chatterId) {
    const { data: changes, error: changesErr } = await sb
      .from('suspicious_status_changes')
      .select('id, moderator_login, low_trust_status, changed_at')
      .eq('stream_id', access.streamId)
      .eq('chatter_user_id', filters.chatterId)
      .order('changed_at', { ascending: false })
      .limit(STATUS_HISTORY_LIMIT);
    if (changesErr) console.error('suspicious-log: status history failed:', changesErr.message);
    statusChanges = changes ?? [];
  }

  const body: LogResponse = {
    items: error ? [] : data ?? [],
    total: count ?? 0,
    page: filters.page,
    pageSize: LOG_PAGE_SIZE,
    statusChanges,
    canDelete: access.role === 'streamer',
    logEnabled: access.logEnabled,
    logStatus: access.logStatus,
    logStatusAt: access.logStatusAt,
  };
  return reply(body);
}

// Permanently removes selected messages. Streamer only.
export async function DELETE(req: NextRequest) {
  const access = await getSuspiciousLogAccess();
  if (!access.ok) return denied(access.reason);
  if (access.role !== 'streamer') return denied('forbidden');

  const body = await req.json().catch(() => ({}));
  const ids: unknown = body.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_DELETE_IDS ||
    !ids.every((id) => typeof id === 'string' && UUID.test(id))
  ) {
    return reply({ error: 'invalid ids' }, 400);
  }

  const { error, count } = await supabaseAdmin()
    .from('suspicious_messages')
    .delete({ count: 'exact' })
    .eq('stream_id', access.streamId)
    .in('id', ids);
  if (error) {
    console.error('suspicious-log: delete failed:', error.message);
    return reply({ error: 'could not delete messages' }, 500);
  }
  return reply({ ok: true, deleted: count ?? 0 });
}
