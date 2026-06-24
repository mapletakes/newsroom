import { supabaseAdmin } from './supabase';
import type { Session } from './session';

// Whether a moderator is authorized to curate (organize) a stream's deck.
export async function canMemberCurate(
  streamId: string,
  twitchUserId: string,
): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('moderators')
    .select('can_curate')
    .eq('stream_id', streamId)
    .eq('twitch_user_id', twitchUserId)
    .maybeSingle();
  return data?.can_curate === true;
}

// Whether a session may curate the deck: the streamer always can; a mod only
// if they've been granted can_curate. Use this to gate every deck-organizing
// mutation (reorder, move, segment CRUD), so the permission is enforced on the
// server and not just hidden in the UI.
export async function sessionCanCurate(session: Session): Promise<boolean> {
  if (session.role === 'streamer') return true;
  return canMemberCurate(session.streamId, session.twitchUserId);
}
