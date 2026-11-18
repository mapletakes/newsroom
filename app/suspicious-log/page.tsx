import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { StreamTheme } from '@/components/StreamTheme';
import { isAdmin } from '@/lib/admin';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { getSuspiciousLogAccess, type LogDenied } from '@/lib/suspicious-log-access';
import { SuspiciousLogView } from './SuspiciousLogView';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Suspicious log — The Broadside',
  robots: { index: false, follow: false },
};

const DENIED_MESSAGES: Record<Exclude<LogDenied, 'unauthenticated'>, string> = {
  forbidden: 'This log is only available to the channel’s streamer and current moderators.',
  reconnect: 'Sign out and back in with Twitch so we can confirm you still moderate this channel.',
  twitch: 'We couldn’t confirm your moderator status with Twitch. Try again in a moment.',
};

export default async function SuspiciousLogPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const { data: stream } = await supabaseAdmin()
    .from('streams')
    .select('approved')
    .eq('id', session.streamId)
    .maybeSingle();
  if (stream?.approved === false) redirect('/blocked');

  const access = await getSuspiciousLogAccess();
  if (!access.ok) {
    if (access.reason === 'unauthenticated') redirect('/login');
    return (
      <div className="min-h-screen flex flex-col">
        <AppHeader
          className="border-b-2 border-ink px-6 py-3 gap-6"
          section="suspicious log"
          right={<Link href="/choose" className="underline hover:text-rust">Switch Channel</Link>}
        />
        <main className="px-6 py-16 max-w-xl mx-auto text-center">
          <h1 className="font-display text-3xl font-bold mb-3">Log unavailable</h1>
          <p className="text-ink/70">{DENIED_MESSAGES[access.reason]}</p>
        </main>
      </div>
    );
  }

  return (
    <>
      <StreamTheme />
      <SuspiciousLogView
        displayName={session.displayName}
        isAdmin={isAdmin(session.twitchUserId)}
        isMod={access.role === 'mod'}
      />
    </>
  );
}
