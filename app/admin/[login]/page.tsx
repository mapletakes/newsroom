import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { isAdmin, estimateCost, CHANNEL_MODULES, type ChannelModuleKey } from '@/lib/admin';
import { listSubscriptions } from '@/lib/twitch-eventsub';
import { AppHeader } from '@/components/AppHeader';
import { AdminChannelDetail, type ChannelDetail } from './AdminChannelDetail';

export const dynamic = 'force-dynamic';

export default async function AdminChannelPage({ params }: { params: { login: string } }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isAdmin(session.twitchUserId)) redirect('/');

  // Twitch logins are already lowercase at the source (app/api/twitch/callback),
  // but the URL is user-typed/pasted, so normalise before the lookup.
  const login = params.login.toLowerCase();
  const sb = supabaseAdmin();
  const { data: stream } = await sb.from('streams').select('*').eq('twitch_login', login).maybeSingle();
  if (!stream) notFound();

  const [total, pending, last, summaries, searches, recent] = await Promise.all([
    sb.from('submissions').select('*', { count: 'exact', head: true }).eq('stream_id', stream.id),
    sb.from('submissions').select('*', { count: 'exact', head: true }).eq('stream_id', stream.id).eq('status', 'pending'),
    sb.from('submissions').select('created_at').eq('stream_id', stream.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('submissions').select('*', { count: 'exact', head: true }).eq('stream_id', stream.id).not('summary', 'is', null),
    sb.from('submissions').select('*', { count: 'exact', head: true }).eq('stream_id', stream.id).not('related_coverage', 'is', null),
    sb.from('submissions').select('id, url, title, status, created_at').eq('stream_id', stream.id).order('created_at', { ascending: false }).limit(15),
  ]);

  // Single-channel lookup, not the list page's fan-out concern — one row, so
  // a handful of direct queries beats reusing admin_submission_stats and
  // discarding every other channel's row from its result.
  let eventsub = 'none';
  try {
    const subs = await listSubscriptions('channel.chat.message');
    for (const s of subs as { condition: { broadcaster_user_id: string }; status: string }[]) {
      if (s.condition.broadcaster_user_id === stream.twitch_user_id && (eventsub === 'none' || s.status === 'enabled')) {
        eventsub = s.status;
      }
    }
  } catch {
    /* leave unknown */
  }

  const summaryCount = summaries.count ?? 0;
  const searchCount = searches.count ?? 0;

  const initial: ChannelDetail = {
    id: stream.id,
    login: stream.twitch_login,
    displayName: stream.display_name,
    createdAt: stream.created_at,
    approved: stream.approved !== false,
    chatEnabled: !!stream.access_token,
    modules: Object.fromEntries(CHANNEL_MODULES.map((m) => [m.key, stream[m.key] === true])) as Record<ChannelModuleKey, boolean>,
    eventsub,
    total: total.count ?? 0,
    pending: pending.count ?? 0,
    lastAt: last.data?.created_at ?? null,
    summaries: summaryCount,
    searches: searchCount,
    estCost: estimateCost(summaryCount, searchCount),
  };

  return (
    <div className="min-h-screen px-6 py-10 max-w-4xl mx-auto">
      <AppHeader
        className="mb-8 gap-3"
        section="admin"
        right={
          <Link href="/admin" className="text-ink/60 hover:text-ink hover:underline">
            ← All channels
          </Link>
        }
      />
      <AdminChannelDetail initial={initial} recent={recent.data ?? []} />
    </div>
  );
}
