import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { isAdmin } from '@/lib/admin';
import { canMemberCurate } from '@/lib/curate';
import { StreamTheme } from '@/components/StreamTheme';
import { ShelfDetailView } from './ShelfDetailView';

export const dynamic = 'force-dynamic';

export default async function ShelfDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect('/login');

  const sb = supabaseAdmin();
  const { data: stream } = await sb.from('streams').select('approved').eq('id', session.streamId).maybeSingle();
  if (stream?.approved === false) redirect('/blocked');

  const { data: shelf } = await sb
    .from('lists')
    .select('id')
    .eq('id', id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!shelf) redirect('/shelf');

  const canCurate = session.role === 'streamer' || (await canMemberCurate(session.streamId, session.twitchUserId));

  return (
    <>
      <StreamTheme />
      <ShelfDetailView
        shelfId={id}
        streamId={session.streamId}
        displayName={session.displayName}
        isAdmin={isAdmin(session.twitchUserId)}
        isMod={session.role === 'mod'}
        canCurate={canCurate}
      />
    </>
  );
}
