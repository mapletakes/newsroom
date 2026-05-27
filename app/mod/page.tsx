import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
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

  return (
    <ModView
      channel={session.twitchLogin}
      displayName={session.displayName}
      submitCommand={stream?.submit_command || null}
      allowAnyone={stream?.allow_anyone ?? true}
    />
  );
}
