import { NextResponse } from 'next/server';
import { getSession, sessionLogin } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { getValidAccessToken } from '@/lib/announce';
import { TwitchApiError } from '@/lib/twitch-oauth';
import { syncModeratorRows } from '@/lib/twitch-link';
import { listModeratedStreams } from '@/lib/mod-channels';

export const dynamic = 'force-dynamic';

// Re-asks Twitch which channels this person moderates and records any new
// ones. The `moderators` rows were previously written only at sign-in, so a
// channel someone started modding afterwards never appeared in the picker
// until they logged out and back in. Only adds rows — see syncModeratorRows.
//
// Uses the caller's OWN stored Twitch token (the one saved on their own stream
// row at sign-in), not whichever stream they're currently switched into.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!session.twitchUserId) {
    return NextResponse.json({ error: 'no linked Twitch account' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: own } = await sb
    .from('streams')
    .select('id')
    .eq('twitch_user_id', session.twitchUserId)
    .maybeSingle();

  // No stored token, or Twitch won't refresh it: only a fresh sign-in fixes that.
  const token = own ? await getValidAccessToken(own.id) : null;
  if (!token) return NextResponse.json({ error: 'reconnect' }, { status: 400 });

  try {
    await syncModeratorRows(
      sb,
      token,
      { id: session.twitchUserId, login: sessionLogin(session), display_name: session.displayName },
      { strict: true },
    );
  } catch (err) {
    // 401/403 is a token that's revoked or predates the moderated-channels
    // scope — the person has to reconnect. Anything else is Twitch (or us)
    // having a bad moment, which isn't theirs to fix.
    if (err instanceof TwitchApiError && (err.status === 401 || err.status === 403)) {
      return NextResponse.json({ error: 'reconnect' }, { status: 400 });
    }
    console.error('refresh-channels failed:', err);
    return NextResponse.json({ error: 'twitch' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, channels: await listModeratedStreams(sb, session.twitchUserId) });
}
