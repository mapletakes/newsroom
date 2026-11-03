import type { supabaseAdmin } from './supabase';

type Sb = ReturnType<typeof supabaseAdmin>;

export type ChannelOption = { id: string; login: string; name: string };

/**
 * The channels this Twitch user is a recorded moderator for, as the picker
 * shows them. Reads the `moderators` table only — that table is filled in by
 * syncModeratorRows (at sign-in, and by the picker's refresh), so a channel
 * that became modded after the last sync isn't here until one runs.
 * Sorted by display name so a newly found channel doesn't reshuffle the list
 * into an order that differs from the next page load.
 */
export async function listModeratedStreams(sb: Sb, twitchUserId: string): Promise<ChannelOption[]> {
  const { data: modRows } = await sb
    .from('moderators')
    .select('stream_id')
    .eq('twitch_user_id', twitchUserId);

  const streamIds = (modRows || []).map((r) => r.stream_id);
  if (streamIds.length === 0) return [];

  const { data } = await sb
    .from('streams')
    .select('id, twitch_login, display_name')
    .in('id', streamIds);

  return (data || [])
    .map((s) => ({ id: s.id, login: s.twitch_login, name: s.display_name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
