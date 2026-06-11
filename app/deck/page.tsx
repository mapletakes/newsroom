import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { isAdmin } from '@/lib/admin';
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

  return (
    <DeckView
      displayName={session.displayName}
      streamId={session.streamId}
      isAdmin={isAdmin(session.twitchUserId)}
    />
  );
}
