import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSuspiciousLogAccess } from '@/lib/suspicious-log-access';
import { applyLogFilters } from '@/lib/suspicious-log-filters';
import { denied, reply } from '@/lib/suspicious-log-http';
import {
  LOG_PAGE_SIZE,
  MAX_DELETE_IDS,
  chunk,
  parseLogFilters,
  type LogResponse,
} from '@/lib/suspicious-log-query';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_HISTORY_LIMIT = 50;

// One page of a channel's log. Filtering happens in the database because a
// year of messages is too much to send to the browser.
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

  query = applyLogFilters(query, filters);

  // The id breaks ties so two messages in the same instant keep a stable order
  // from one page to the next.
  const ascending = filters.order === 'oldest';
  const start = (filters.page - 1) * LOG_PAGE_SIZE;
  const { data, error, count } = await query
    .order('sent_at', { ascending })
    .order('id', { ascending })
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

  // In small batches: the ids travel in the request URL, and 200 of them can
  // run past its length limit.
  const sb = supabaseAdmin();
  let deleted = 0;
  for (const batch of chunk(ids as string[])) {
    const { error, count } = await sb
      .from('suspicious_messages')
      .delete({ count: 'exact' })
      .eq('stream_id', access.streamId)
      .in('id', batch);
    if (error) {
      console.error('suspicious-log: delete failed:', error.message);
      return reply({ error: 'could not delete messages', deleted }, 500);
    }
    deleted += count ?? 0;
  }
  return reply({ ok: true, deleted });
}
