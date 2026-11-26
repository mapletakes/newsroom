import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { StreamTheme } from '@/components/StreamTheme';
import { getSession } from '@/lib/session';
import { getStreamControlAccess } from '@/lib/stream-control';
import { supabaseAdmin } from '@/lib/supabase';
import { RelayView } from './RelayView';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Stream control relay — The Broadside',
  robots: { index: false, follow: false },
};

function Unavailable({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen flex flex-col">
      <StreamTheme />
      <AppHeader className="border-b-2 border-ink px-6 py-3 gap-6" section="stream control" />
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="font-display text-3xl font-bold mb-2">{title}</h1>
          <p className="text-ink/60 leading-relaxed mb-6">{body}</p>
          <Link href="/deck" className="underline hover:text-rust font-mono text-sm">
            ← Back to the deck
          </Link>
        </div>
      </main>
    </div>
  );
}

// The streamer opens this on the PC that runs Streamlabs and leaves it open
// while they stream. It is the only thing that talks to Streamlabs.
export default async function StreamControlRelayPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const { data: stream } = await supabaseAdmin()
    .from('streams')
    .select('approved')
    .eq('id', session.streamId)
    .maybeSingle();
  if (stream?.approved === false) redirect('/blocked');

  const access = await getStreamControlAccess(session);
  if (!access.enabled) {
    return (
      <Unavailable
        title="Stream control isn't on for this account"
        body="Stream control lets mods you choose switch your Streamlabs scenes and show or hide sources. It's enabled per account by a Broadside admin."
      />
    );
  }
  if (!access.canRunRelay) {
    return (
      <Unavailable
        title="Only the streamer runs the relay"
        body="The relay runs on the streamer's own PC, next to Streamlabs."
      />
    );
  }

  return (
    <>
      <StreamTheme />
      <RelayView streamId={session.streamId} />
    </>
  );
}
