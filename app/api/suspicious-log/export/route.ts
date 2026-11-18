import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSuspiciousLogAccess } from '@/lib/suspicious-log-access';
import { toCsv, toText, type ExportRow } from '@/lib/suspicious-log-export';
import { applyLogFilters } from '@/lib/suspicious-log-filters';
import { denied, reply } from '@/lib/suspicious-log-http';
import { MAX_EXPORT_ROWS, formatUtc, parseLogFilters } from '@/lib/suspicious-log-query';

export const dynamic = 'force-dynamic';

const BATCH = 1000;
const COLUMNS =
  'sent_at, chatter_login, chatter_name, message_text, low_trust_status, detection_types, ban_evasion_evaluation';

// Downloads whatever the log page is showing (every page of it, with the same
// filters) as CSV or plain text. Times are UTC, since the file leaves the
// person's browser and the reader's zone is unknown.
export async function GET(req: NextRequest) {
  const access = await getSuspiciousLogAccess();
  if (!access.ok) return denied(access.reason);

  const params = req.nextUrl.searchParams;
  const format = params.get('format') === 'txt' ? 'txt' : 'csv';
  const filters = parseLogFilters(params);
  const ascending = filters.order === 'oldest';
  const sb = supabaseAdmin();

  const rows: ExportRow[] = [];
  let truncated = false;
  for (let start = 0; start < MAX_EXPORT_ROWS; start += BATCH) {
    const query = applyLogFilters(
      sb.from('suspicious_messages').select(COLUMNS).eq('stream_id', access.streamId),
      filters,
    );
    const { data, error } = await query
      .order('sent_at', { ascending })
      .order('id', { ascending })
      .range(start, start + BATCH - 1);
    if (error) {
      console.error('suspicious-log: export failed:', error.message);
      return reply({ error: 'could not export the log' }, 500);
    }
    const batch = (data ?? []) as ExportRow[];
    rows.push(...batch);
    if (batch.length < BATCH) break;
    if (start + BATCH >= MAX_EXPORT_ROWS) truncated = true;
  }

  // The byte-order mark makes Excel read the file as UTF-8, so emoji and
  // accented names survive.
  const body =
    format === 'csv' ? `﻿${toCsv(rows)}` : `${toText(rows, (iso) => `${formatUtc(iso)} UTC`)}\n`;
  const day = new Date().toISOString().slice(0, 10);

  return new Response(body, {
    headers: {
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="suspicious-log-${day}.${format}"`,
      'Cache-Control': 'no-store',
      ...(truncated ? { 'X-Export-Truncated': 'true' } : {}),
    },
  });
}
