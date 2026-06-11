import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { isAdmin } from '@/lib/admin';
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

  return (
    <ModView
      channel={stream?.twitch_login || session.twitchLogin}
      displayName={session.displayName}
      streamDisplayName={stream?.display_name || session.displayName}
      submitCommand={stream?.submit_command || null}
      streamId={session.streamId}
      isMod={session.role === 'mod'}
      isAdmin={isAdmin(session.twitchUserId)}
    />
  );
}
