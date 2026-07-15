import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { isAdmin } from '@/lib/admin';
import { canMemberCurate } from '@/lib/curate';
import { ShelfView } from './ShelfView';

export const dynamic = 'force-dynamic';

export default async function ShelfPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const sb = supabaseAdmin();
  const { data: stream } = await sb.from('streams').select('approved').eq('id', session.streamId).maybeSingle();
  if (stream?.approved === false) redirect('/blocked');

  const canCurate = session.role === 'streamer' || (await canMemberCurate(session.streamId, session.twitchUserId));

  return (
    <ShelfView
      displayName={session.displayName}
      isAdmin={isAdmin(session.twitchUserId)}
      isMod={session.role === 'mod'}
      canCurate={canCurate}
    />
  );
}
