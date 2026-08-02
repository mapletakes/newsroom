import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { isAdmin } from '@/lib/admin';
import { canMemberCurate } from '@/lib/curate';
import { StreamTheme } from '@/components/StreamTheme';
import { ModView } from './ModView';

export const dynamic = 'force-dynamic';

export default async function ModPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('*')
    .eq('id', session.streamId)
    .single();

  if (stream?.approved === false) redirect('/blocked');

  const isModRole = session.role === 'mod';
  // Streamers always reach the deck; mods only if authorized to curate.
  const canCurate = isModRole ? await canMemberCurate(session.streamId, session.twitchUserId) : true;

  return (
    <>
      <StreamTheme />
      <ModView
        channel={stream?.twitch_login || session.twitchLogin}
        displayName={session.displayName}
        streamDisplayName={stream?.display_name || session.displayName}
        submitCommand={stream?.submit_command || null}
        streamId={session.streamId}
        isMod={isModRole}
        isAdmin={isAdmin(session.twitchUserId)}
        canCurate={canCurate}
        questionsEnabled={stream?.questions_enabled === true}
        modStatusEnabled={stream?.mod_status_enabled === true}
      />
    </>
  );
}
