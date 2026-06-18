import { supabaseAdmin } from './supabase';

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
