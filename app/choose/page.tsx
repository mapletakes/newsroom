import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { listModeratedStreams } from '@/lib/mod-channels';
import { ChooseView } from './ChooseView';

export const dynamic = 'force-dynamic';

export default async function ChoosePage() {
  const session = await getSession();
  if (!session) redirect('/login');
  // The picker exists to choose between Twitch channels; accounts without a
  // linked Twitch identity only have their own deck.
  if (!session.twitchUserId) redirect('/deck');

  const sb = supabaseAdmin();

  // Get this user's own stream
  const { data: ownStream } = await sb
    .from('streams')
    .select('id, twitch_login, display_name')
    .eq('twitch_user_id', session.twitchUserId)
    .single();

  // Streams this user moderates, as of the last sync — ChooseView re-syncs
  // against Twitch after it loads (see /api/auth/refresh-channels).
  const modStreams = await listModeratedStreams(sb, session.twitchUserId);

  return (
    <ChooseView
      displayName={session.displayName}
      ownStream={ownStream ? { id: ownStream.id, login: ownStream.twitch_login, name: ownStream.display_name } : null}
      modStreams={modStreams}
    />
  );
}
