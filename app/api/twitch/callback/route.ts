import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, fetchTwitchUser, fetchModeratedChannels } from '@/lib/twitch-oauth';
import { supabaseAdmin } from '@/lib/supabase';
import { buildSessionCookie, verifyOAuthState } from '@/lib/session';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code || !state || !verifyOAuthState(state)) {
    return new NextResponse(null, {
      status: 302,
      headers: { Location: new URL('/login?error=state', req.url).toString() },
    });
  }

  try {
    const tokens = await exchangeCode(code);
    const user = await fetchTwitchUser(tokens.access_token);

    const sb = supabaseAdmin();

    // Upsert this user's own stream row
    const { data: stream, error } = await sb
      .from('streams')
      .upsert(
        {
          twitch_user_id: user.id,
          twitch_login: user.login,
          display_name: user.display_name,
        },
        { onConflict: 'twitch_user_id' },
      )
      .select()
      .single();
    if (error || !stream) throw error || new Error('No stream row');

    // Check which Twitch channels this user mods for
    const modChannels = await fetchModeratedChannels(tokens.access_token, user.id);

    // Find which of those channels are registered Newsroom streamers
    if (modChannels.length > 0) {
      const modTwitchIds = modChannels.map((c) => c.broadcaster_id);
      const { data: matchedStreams } = await sb
        .from('streams')
        .select('id, twitch_user_id, twitch_login, display_name')
        .in('twitch_user_id', modTwitchIds);

      // Upsert moderator rows for each match
      if (matchedStreams && matchedStreams.length > 0) {
        for (const ms of matchedStreams) {
          await sb.from('moderators').upsert(
            {
              stream_id: ms.id,
              twitch_user_id: user.id,
              twitch_login: user.login,
            },
            { onConflict: 'stream_id,twitch_user_id' },
          );
        }
      }
    }

    // Check if this user is a mod for any Newsroom streams
    const { data: modRows } = await sb
      .from('moderators')
      .select('stream_id')
      .eq('twitch_user_id', user.id);
    const hasModChannels = modRows && modRows.length > 0;

    // Default session: logged in as streamer on their own channel
    const session = buildSessionCookie({
      streamId: stream.id,
      twitchUserId: user.id,
      twitchLogin: user.login,
      displayName: user.display_name,
      role: 'streamer',
    });

    // If they mod for other channels, send to picker; otherwise straight to deck
    const dest = hasModChannels ? '/choose' : '/deck';
    const response = new NextResponse(null, {
      status: 302,
      headers: { Location: new URL(dest, req.url).toString() },
    });
    response.cookies.set(session.name, session.value, session.options);
    return response;
  } catch (err) {
    console.error(err);
    return new NextResponse(null, {
      status: 302,
      headers: { Location: new URL('/login?error=oauth', req.url).toString() },
    });
  }
}
