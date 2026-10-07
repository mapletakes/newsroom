import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { isAdmin } from '@/lib/admin';
import { canMemberCurate, canMemberSetNowPlaying } from '@/lib/curate';
import { StreamTheme } from '@/components/StreamTheme';
import { DeckView } from './DeckView';

export const dynamic = 'force-dynamic';

export default async function DeckPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('approved, twitch_user_id, questions_enabled, questions_open, mod_status_enabled, raffle_enabled, discord_webhook_url')
    .eq('id', session.streamId)
    .maybeSingle();
  if (stream?.approved === false) redirect('/blocked');

  // Mods may only reach the deck if the streamer authorized them to curate,
  // and then only in curate-only mode (no live playback controls) — unless
  // also separately granted can_set_now_playing, which lets them correct
  // what's on air without the rest of live playback control.
  const curateOnly = session.role === 'mod';
  if (curateOnly && !(await canMemberCurate(session.streamId, session.twitchUserId))) {
    redirect('/mod');
  }
  const canSetNowPlaying = curateOnly
    ? await canMemberSetNowPlaying(session.streamId, session.twitchUserId)
    : true;

  // No linked Twitch channel → no chat to read from or post to, so the chat
  // features (and the admin-gated modules built on them) are off entirely.
  const chatEnabled = !!stream?.twitch_user_id;

  return (
    <>
      <StreamTheme />
      <DeckView
        displayName={session.displayName}
        streamId={session.streamId}
        isAdmin={isAdmin(session.twitchUserId)}
        curateOnly={curateOnly}
        chatEnabled={chatEnabled}
        canSetNowPlaying={canSetNowPlaying}
        questionsEnabled={chatEnabled && stream?.questions_enabled === true}
        questionsOpen={stream?.questions_open !== false}
        modStatusEnabled={chatEnabled && stream?.mod_status_enabled === true}
        raffleEnabled={chatEnabled && stream?.raffle_enabled === true}
        discordWebhookConfigured={!!stream?.discord_webhook_url}
      />
    </>
  );
}
