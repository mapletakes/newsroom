import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { ChooseView } from './ChooseView';

export const dynamic = 'force-dynamic';

export default async function ChoosePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const sb = supabaseAdmin();

  // Get this user's own stream
  const { data: ownStream } = await sb
    .from('streams')
    .select('id, twitch_login, display_name')
    .eq('twitch_user_id', session.twitchUserId)
    .single();

  // Get streams this user moderates
  const { data: modRows } = await sb
    .from('moderators')
    .select('stream_id')
    .eq('twitch_user_id', session.twitchUserId);

  const modStreamIds = (modRows || []).map((r) => r.stream_id);
  let modStreams: { id: string; twitch_login: string; display_name: string }[] = [];
  if (modStreamIds.length > 0) {
    const { data } = await sb
      .from('streams')
      .select('id, twitch_login, display_name')
      .in('id', modStreamIds);
    modStreams = data || [];
  }

  return (
    <ChooseView
      displayName={session.displayName}
      ownStream={ownStream ? { id: ownStream.id, login: ownStream.twitch_login, name: ownStream.display_name } : null}
      modStreams={modStreams.map((s) => ({ id: s.id, login: s.twitch_login, name: s.display_name }))}
    />
  );
}
