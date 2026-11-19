import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSuspiciousLogAccess } from '@/lib/suspicious-log-access';
import { denied, reply } from '@/lib/suspicious-log-http';
import { chunk } from '@/lib/suspicious-log-query';
import { parseNetworkFilter, type NetworkResponse } from '@/lib/chatter-flag-types';
import {
  groupNetworkFlags,
  matchesNetworkFilter,
  type NetworkFlagRow,
  type ReviewRow,
} from '@/lib/chatter-flags';

export const dynamic = 'force-dynamic';

/** Live flags loaded per request. Enough for a long time; past it, the
 *  response says so rather than quietly dropping the oldest. */
const NETWORK_LIMIT = 500;
/** Log rows read per batch of chatters to learn who's in this channel's log.
 *  One very chatty chatter can use up a batch's rows and hide another's entry,
 *  but that only drops the "in your log" hint, never a flag. */
const IN_LOG_ROWS = 1000;

// Never asks for created_by_*: who on a channel's team made a flag doesn't
// leave that channel, and the safest way to keep that true is to never load it.
const NETWORK_COLUMNS =
  'id, chatter_user_id, chatter_login, chatter_name, category, context, created_at, updated_at, ' +
  'streams(display_name, twitch_login, approved), ' +
  'chatter_flag_messages(suspicious_messages(id, sent_at, message_text, low_trust_status))';

// Other channels' live flags, grouped by chatter, with what this channel decided
// about each. Streamer and current mods, once the streamer has turned receiving
// flags on. `?filter=` is new (default), all, banned, watching or dismissed.
export async function GET(req: NextRequest) {
  const access = await getSuspiciousLogAccess();
  if (!access.ok) return denied(access.reason);

  const sb = supabaseAdmin();
  const { data: stream, error: streamErr } = await sb
    .from('streams')
    .select('flag_network_subscribed')
    .eq('id', access.streamId)
    .maybeSingle();
  if (streamErr) {
    console.error('flag-network: channel lookup failed:', streamErr.message);
    return reply({ error: 'could not load network flags' }, 500);
  }

  const base = {
    logEnabled: access.logEnabled,
    subscribed: stream?.flag_network_subscribed === true,
    canSubscribe: access.role === 'streamer',
  };
  if (!base.logEnabled || !base.subscribed) {
    return reply({ ...base, chatters: [], truncated: false } satisfies NetworkResponse);
  }

  const now = new Date().toISOString();
  const { data, error } = await sb
    .from('chatter_flags')
    .select(NETWORK_COLUMNS)
    .neq('stream_id', access.streamId)
    .is('withdrawn_at', null)
    .is('removed_at', null)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(NETWORK_LIMIT + 1);
  if (error) {
    console.error('flag-network: flag list failed:', error.message);
    return reply({ error: 'could not load network flags' }, 500);
  }
  // supabase-js types every embed as an array without generated types; the
  // many-to-one embeds here (streams, suspicious_messages) arrive as objects.
  const all = (data ?? []) as unknown as NetworkFlagRow[];
  const truncated = all.length > NETWORK_LIMIT;
  const rows = all.slice(0, NETWORK_LIMIT);

  const chatterIds = [...new Set(rows.map((r) => r.chatter_user_id))];
  const reviews: ReviewRow[] = [];
  const inMyLog = new Set<string>();
  for (const ids of chunk(chatterIds)) {
    const [reviewed, logged] = await Promise.all([
      sb
        .from('chatter_flag_reviews')
        .select('chatter_user_id, decision, decided_by_login, decided_at')
        .eq('stream_id', access.streamId)
        .in('chatter_user_id', ids),
      sb
        .from('suspicious_messages')
        .select('chatter_user_id')
        .eq('stream_id', access.streamId)
        .in('chatter_user_id', ids)
        .limit(IN_LOG_ROWS),
    ]);
    if (reviewed.error || logged.error) {
      console.error('flag-network: lookup failed:', reviewed.error?.message ?? logged.error?.message);
      return reply({ error: 'could not load network flags' }, 500);
    }
    reviews.push(...((reviewed.data ?? []) as ReviewRow[]));
    for (const row of logged.data ?? []) inMyLog.add(row.chatter_user_id);
  }

  const filter = parseNetworkFilter(req.nextUrl.searchParams.get('filter'));
  const chatters = groupNetworkFlags(rows, reviews, inMyLog).filter((c) => matchesNetworkFilter(c, filter));
  return reply({ ...base, chatters, truncated } satisfies NetworkResponse);
}
