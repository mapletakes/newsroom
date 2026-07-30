import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { isAdmin } from '@/lib/admin';
import { canMemberCurate } from '@/lib/curate';
import { StreamTheme } from '@/components/StreamTheme';
import { DeckView } from './DeckView';

export const dynamic = 'force-dynamic';

export default async function DeckPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('approved')
    .eq('id', session.streamId)
    .maybeSingle();
  if (stream?.approved === false) redirect('/blocked');

  // Mods may only reach the deck if the streamer authorized them to curate,
  // and then only in curate-only mode (no live playback controls).
  const curateOnly = session.role === 'mod';
  if (curateOnly && !(await canMemberCurate(session.streamId, session.twitchUserId))) {
    redirect('/mod');
  }

  return (
    <>
      <StreamTheme />
      <DeckView
        displayName={session.displayName}
        streamId={session.streamId}
        isAdmin={isAdmin(session.twitchUserId)}
        curateOnly={curateOnly}
      />
    </>
  );
}
