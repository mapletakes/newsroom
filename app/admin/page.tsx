import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { isAdmin, estimateCost } from '@/lib/admin';
import { listSubscriptions } from '@/lib/twitch-eventsub';
import { AppHeader } from '@/components/AppHeader';
import { AdminChannels, type ChannelRow } from './AdminChannels';

export const dynamic = 'force-dynamic';

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { window?: string };
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isAdmin(session.twitchUserId)) redirect('/');

  const win = searchParams.window === '30d' ? '30d' : 'all';
  const since = win === '30d' ? new Date(Date.now() - 30 * 86_400_000).toISOString() : null;

  const sb = supabaseAdmin();
  const { data: streams } = await sb
    .from('streams')
    .select('id, twitch_user_id, twitch_login, display_name, created_at, approved, access_token, questions_enabled, mod_status_enabled, raffle_enabled')
    .order('created_at', { ascending: true });

  // EventSub status for every channel in one Twitch call.
  const subStatus = new Map<string, string>();
  try {
    const subs = await listSubscriptions('channel.chat.message');
    for (const s of subs as { condition: { broadcaster_user_id: string }; status: string }[]) {
      // Prefer an "enabled" sub if multiple exist.
      const prev = subStatus.get(s.condition.broadcaster_user_id);
      if (!prev || s.status === 'enabled') subStatus.set(s.condition.broadcaster_user_id, s.status);
    }
  } catch {
    /* leave statuses unknown */
  }

  const rows: ChannelRow[] = await Promise.all(
    (streams || []).map(async (st): Promise<ChannelRow> => {
      // Usage counts respect the selected window; channel stats stay all-time.
      let sumQ = sb.from('submissions').select('*', { count: 'exact', head: true }).eq('stream_id', st.id).not('summary', 'is', null);
      let srchQ = sb.from('submissions').select('*', { count: 'exact', head: true }).eq('stream_id', st.id).not('related_coverage', 'is', null);
      if (since) {
        sumQ = sumQ.gte('created_at', since);
        srchQ = srchQ.gte('created_at', since);
      }
      const [total, pending, last, summaries, searches] = await Promise.all([
        sb.from('submissions').select('*', { count: 'exact', head: true }).eq('stream_id', st.id),
        sb.from('submissions').select('*', { count: 'exact', head: true }).eq('stream_id', st.id).eq('status', 'pending'),
        sb.from('submissions').select('created_at').eq('stream_id', st.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        sumQ,
        srchQ,
      ]);
      const summaryCount = summaries.count ?? 0;
      const searchCount = searches.count ?? 0;
      return {
        id: st.id,
        login: st.twitch_login,
        displayName: st.display_name,
        createdAt: st.created_at,
        approved: st.approved !== false,
        questionsEnabled: st.questions_enabled === true,
        modStatusEnabled: st.mod_status_enabled === true,
        raffleEnabled: st.raffle_enabled === true,
        chatEnabled: !!st.access_token,
        eventsub: subStatus.get(st.twitch_user_id) || 'none',
        total: total.count ?? 0,
        pending: pending.count ?? 0,
        lastAt: last.data?.created_at ?? null,
        summaries: summaryCount,
        searches: searchCount,
        estCost: estimateCost(summaryCount, searchCount),
      };
    }),
  );

  const activeChannels = rows.filter((r) => r.eventsub === 'enabled').length;
  const totalCost = rows.reduce((sum, r) => sum + r.estCost, 0);

  return (
    <div className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <AppHeader
        className="mb-8 gap-3"
        section="admin"
        right={
          <span className="text-ink/60">
            {rows.length} channels · {activeChannels} listening · ~${totalCost.toFixed(2)} est.
          </span>
        }
      />

      <h1 className="font-display text-4xl font-bold mb-2">Channels</h1>
      <div className="flex items-center gap-1 mb-3 font-mono text-xs uppercase tracking-widest">
        <span className="text-ink/50 mr-1">Usage window:</span>
        <Link
          href="/admin"
          className={`px-3 py-1 border ${win === 'all' ? 'bg-ink text-paper border-ink' : 'border-ink/30 hover:border-ink'}`}
        >
          All time
        </Link>
        <Link
          href="/admin?window=30d"
          className={`px-3 py-1 border ${win === '30d' ? 'bg-ink text-paper border-ink' : 'border-ink/30 hover:border-ink'}`}
        >
          30 days
        </Link>
      </div>
      <p className="font-mono text-xs text-ink/50 mb-4">
        Usage reflects {win === '30d' ? 'the last 30 days' : 'all time'}; cost is a rough estimate, not a billed amount.
      </p>
      <div className="rule-double mb-8" />

      <AdminChannels initial={rows} />
    </div>
  );
}
