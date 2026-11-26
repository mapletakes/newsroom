import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { StreamTheme } from '@/components/StreamTheme';
import { getSession } from '@/lib/session';
import { getStreamControlAccess } from '@/lib/stream-control';
import { supabaseAdmin } from '@/lib/supabase';
import { StreamControlView } from './StreamControlView';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Stream control — The Broadside',
  robots: { index: false, follow: false },
};

function Unavailable({ title, body, back }: { title: string; body: string; back: string }) {
  return (
    <div className="min-h-screen flex flex-col">
      <StreamTheme />
      <AppHeader className="border-b-2 border-ink px-6 py-3 gap-6" section="stream control" />
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="font-display text-3xl font-bold mb-2">{title}</h1>
          <p className="text-ink/60 leading-relaxed mb-6">{body}</p>
          <Link href={back} className="underline hover:text-rust font-mono text-sm">
            ← Back
          </Link>
        </div>
      </main>
    </div>
  );
}

// The panel mods (and the streamer) use to switch scenes and show/hide
// sources. Everything it does goes through the relay on the streamer's PC.
export default async function StreamControlPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const { data: stream } = await supabaseAdmin()
    .from('streams')
    .select('approved, twitch_login')
    .eq('id', session.streamId)
    .maybeSingle();
  if (stream?.approved === false) redirect('/blocked');

  const isMod = session.role === 'mod';
  const back = isMod ? '/mod' : '/deck';
  const access = await getStreamControlAccess(session);
  if (!access.enabled) {
    return (
      <Unavailable
        back={back}
        title="Stream control isn't on for this account"
        body="Stream control lets mods the streamer chooses switch Streamlabs scenes and show or hide sources. It's enabled per account by a Broadside admin."
      />
    );
  }
  if (!access.canSwitchScenes && !access.canToggleSources) {
    return (
      <Unavailable
        back={back}
        title="You don't have stream control"
        body="The streamer decides which mods can switch scenes or show and hide sources, in their Broadside settings."
      />
    );
  }

  return (
    <>
      <StreamTheme />
      <StreamControlView
        streamId={session.streamId}
        channel={stream?.twitch_login ?? null}
        isMod={isMod}
      />
    </>
  );
}
