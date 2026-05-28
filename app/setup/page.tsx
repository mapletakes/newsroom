import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { SetupForm } from './SetupForm';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('*')
    .eq('id', session.streamId)
    .single();

  return (
    <SetupForm
      streamId={session.streamId}
      displayName={session.displayName}
      submitCommand={stream?.submit_command ?? ''}
      allowAnyone={stream?.allow_anyone ?? true}
      allowDuplicates={stream?.allow_duplicates ?? false}
      ignoredUsers={stream?.ignored_users ?? []}
      preferredSources={stream?.preferred_sources ?? []}
    />
  );
}
