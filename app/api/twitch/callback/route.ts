import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, fetchTwitchUser, fetchModeratedChannels } from '@/lib/twitch-oauth';
import { createChatSubscription } from '@/lib/twitch-eventsub';
import { supabaseAdmin } from '@/lib/supabase';
import { buildSessionCookie, verifyOAuthStateDetailed } from '@/lib/session';

// Auth callback must never be cached.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Twitch redirects with ?error=... when authorization fails (e.g. denied, invalid scope)
  const twitchError = req.nextUrl.searchParams.get('error');
  if (twitchError) {
    const desc = req.nextUrl.searchParams.get('error_description') || twitchError;
    console.error('Twitch OAuth error:', twitchError, desc);
    return new NextResponse(null, {
      status: 302,
      headers: { Location: new URL(`/login?error=oauth&detail=${encodeURIComponent(desc)}`, req.url).toString() },
    });
  }

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const stateCheck = state ? verifyOAuthStateDetailed(state) : { valid: false, reason: 'bad-parts' as const };
  if (!code || !state || !stateCheck.valid) {
    console.error('OAuth state check failed:', {
      hasCode: !!code,
      hasState: !!state,
      reason: stateCheck.reason,
      ageMs: 'ageMs' in stateCheck ? stateCheck.ageMs : undefined,
    });
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

    // Register EventSub webhook so Twitch pushes chat messages to us.
    // Only attempt if the required scope was actually granted.
    const grantedScopes = tokens.scope || [];
    console.log('OAuth granted scopes:', grantedScopes, 'for user:', user.id, user.login);
    if (grantedScopes.includes('user:read:chat')) {
      createChatSubscription(user.id).catch((err) =>
        console.error('EventSub subscription failed:', err),
      );
    } else {
      console.warn('user:read:chat scope NOT granted. Got:', grantedScopes);
    }

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
