import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { StreamTheme } from '@/components/StreamTheme';
import { AppHeader } from '@/components/AppHeader';
import { ModStatusPageView } from './ModStatusPageView';

export const dynamic = 'force-dynamic';

export default async function ModStatusPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('approved, mod_status_enabled, twitch_login')
    .eq('id', session.streamId)
    .maybeSingle();

  if (stream?.approved === false) redirect('/blocked');

  // Not a redirect: someone with this bookmarked after a super admin turns
  // the feature off should get an explanation, not get silently bounced
  // somewhere else and left wondering why their link changed.
  if (!stream?.mod_status_enabled) {
    return (
      <div className="min-h-screen flex flex-col">
        <StreamTheme />
        <AppHeader className="border-b-2 border-ink px-6 py-3 gap-6" section="mod status" />
        <main className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-md text-center">
            <h1 className="font-display text-3xl font-bold mb-2">Mod status isn&apos;t on for this account</h1>
            <p className="text-ink/60 leading-relaxed mb-6">
              This is the mod availability board — a quick way for the team to see who&apos;s around.
              It&apos;s enabled per account by a Broadside admin — reach out if you&apos;d like it turned
              on.
            </p>
            <Link href="/deck" className="underline hover:text-rust font-mono text-sm">
              ← Back to the deck
            </Link>
          </div>
        </main>
      </div>
    );
  }

  // Every channel this account moderates (not just the one currently active)
  // — lets the header offer a quick switch without a round trip through
  // /choose, which is the whole point on a page mods keep open all night.
  const { data: modRows } = await sb
    .from('moderators')
    .select('stream_id')
    .eq('twitch_user_id', session.twitchUserId);
  const modStreamIds = (modRows || []).map((r) => r.stream_id);
  let modStreams: { id: string; twitch_login: string; display_name: string }[] = [];
  if (modStreamIds.length > 0) {
    const { data } = await sb
      .from('streams')
      .select('id, twitch_login, display_name')
      .in('id', modStreamIds);
    modStreams = data || [];
  }

  return (
    <>
      <StreamTheme />
      <ModStatusPageView
        streamId={session.streamId}
        displayName={session.displayName}
        channel={stream.twitch_login}
        isMod={session.role === 'mod'}
        channels={modStreams.map((s) => ({ id: s.id, login: s.twitch_login, name: s.display_name }))}
      />
    </>
  );
}
