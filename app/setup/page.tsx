import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { isAdmin } from '@/lib/admin';
import { StreamTheme } from '@/components/StreamTheme';
import { sanitizeAppTheme, sanitizeOverlayTheme } from '@/lib/theme';
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

  if (stream?.approved === false) redirect('/blocked');

  const { data: mods } = await sb
    .from('moderators')
    .select('twitch_user_id, twitch_login, can_curate, can_set_now_playing')
    .eq('stream_id', session.streamId)
    .order('twitch_login', { ascending: true });

  return (
    <>
      <StreamTheme />
      <SetupForm
        streamId={session.streamId}
        displayName={session.displayName}
        submitCommand={stream?.submit_command ?? ''}
        videoCommand={stream?.video_command ?? ''}
        allowAnyone={stream?.allow_anyone ?? true}
        allowDuplicates={stream?.allow_duplicates ?? false}
        ignoredUsers={stream?.ignored_users ?? []}
        preferredSources={stream?.preferred_sources ?? []}
        addToken={stream?.add_token ?? null}
        appTheme={sanitizeAppTheme(stream?.app_theme)}
        overlayTheme={sanitizeOverlayTheme(stream?.overlay_theme)}
        questionsEnabled={stream?.questions_enabled === true}
        questionCommand={stream?.question_command ?? ''}
        questionsOpen={stream?.questions_open !== false}
        isAdmin={isAdmin(session.twitchUserId)}
        moderators={(mods ?? []).map((m) => ({
          twitchUserId: m.twitch_user_id,
          login: m.twitch_login,
          canCurate: m.can_curate === true,
          canSetNowPlaying: m.can_set_now_playing === true,
        }))}
      />
    </>
  );
}
