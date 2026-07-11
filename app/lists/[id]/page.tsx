import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { isAdmin } from '@/lib/admin';
import { canMemberCurate } from '@/lib/curate';
import { ListDetailView } from './ListDetailView';

export const dynamic = 'force-dynamic';

export default async function ListDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const sb = supabaseAdmin();
  const { data: stream } = await sb.from('streams').select('approved').eq('id', session.streamId).maybeSingle();
  if (stream?.approved === false) redirect('/blocked');

  const { data: list } = await sb
    .from('lists')
    .select('id')
    .eq('id', params.id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!list) redirect('/lists');

  const canCurate = session.role === 'streamer' || (await canMemberCurate(session.streamId, session.twitchUserId));

  return (
    <ListDetailView
      listId={params.id}
      displayName={session.displayName}
      isAdmin={isAdmin(session.twitchUserId)}
      isMod={session.role === 'mod'}
      canCurate={canCurate}
    />
  );
}
