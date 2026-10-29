import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { isAdmin } from '@/lib/admin';
import { StreamTheme } from '@/components/StreamTheme';
import { ArchivesView } from './ArchivesView';

export const dynamic = 'force-dynamic';

export default async function ArchivesPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const sb = supabaseAdmin();
  const { data: stream } = await sb.from('streams').select('approved, twitch_user_id').eq('id', session.streamId).maybeSingle();
  if (stream?.approved === false) redirect('/blocked');

  return (
    <>
      <StreamTheme />
      <ArchivesView
        displayName={session.displayName}
        isAdmin={isAdmin(session.twitchUserId)}
        chatEnabled={!!stream?.twitch_user_id}
        isMod={session.role === 'mod'}
      />
    </>
  );
}
