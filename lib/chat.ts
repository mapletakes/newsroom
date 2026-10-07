import { NextResponse } from 'next/server';
import { supabaseAdmin } from './supabase';

// Whether a stream has a linked Twitch channel. Everything that reads or
// writes Twitch chat (EventSub capture, "Post to chat", questions, raffles,
// the mod roster) is meaningless without one, so server routes for those
// features check this rather than relying on the UI having hidden the button.
export async function streamHasChat(streamId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('streams')
    .select('twitch_user_id')
    .eq('id', streamId)
    .maybeSingle();
  return !!data?.twitch_user_id;
}

export function noChatResponse() {
  return NextResponse.json(
    { error: 'no-twitch', detail: 'This account has no linked Twitch channel.' },
    { status: 409 },
  );
}

/** Returns a 409 response when the stream has no Twitch channel, else null.
 *  Usage: `const blocked = await requireChat(id); if (blocked) return blocked;` */
export async function requireChat(streamId: string): Promise<NextResponse | null> {
  return (await streamHasChat(streamId)) ? null : noChatResponse();
}
