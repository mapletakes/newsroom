import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, fetchTwitchUser } from '@/lib/twitch-oauth';
import { createChatSubscription } from '@/lib/twitch-eventsub';
import { supabaseAdmin } from '@/lib/supabase';
import { buildSessionCookie, getSession, isLinkState, verifyOAuthStateDetailed } from '@/lib/session';
import { linkTwitchToStream, syncModeratorRows } from '@/lib/twitch-link';
import { requireApproval } from '@/lib/admin';
import { encryptSecret } from '@/lib/crypto';

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

    // Linking Twitch onto an email account the person is already signed in to.
    // Needs BOTH the link-flavoured (signed) state and a live email session;
    // otherwise this is an ordinary Twitch sign-in and falls through.
    if (isLinkState(state)) {
      const current = await getSession();
      if (current && current.role === 'streamer' && !current.twitchUserId) {
        return await handleLink(req, sb, current, tokens, user);
      }
    }

    // Is this a brand-new streamer? (for optional approval gating)
    const { data: existing } = await sb
      .from('streams')
      .select('id')
      .eq('twitch_user_id', user.id)
      .maybeSingle();
    const isNewStreamer = !existing;

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

    // Gate brand-new streamers when approval is required. Separate, non-fatal
    // step so login still works if the `approved` column migration hasn't run.
    if (isNewStreamer && requireApproval()) {
      await sb.from('streams').update({ approved: false }).eq('id', stream.id);
    }

    // Store tokens for posting "now watching" to chat. Separate, non-fatal
    // step so login still works if the token columns migration hasn't run.
    await sb
      .from('streams')
      .update({
        access_token: encryptSecret(tokens.access_token),
        refresh_token: encryptSecret(tokens.refresh_token),
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      })
      .eq('id', stream.id);

    // Record which Newsroom channels this user moderates
    await syncModeratorRows(sb, tokens.access_token, user);

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
      accountId: user.id,
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

// Link flow: attach this Twitch account to the signed-in email account's own
// stream, keeping its deck and shelves, then land back in Settings.
async function handleLink(
  req: NextRequest,
  sb: ReturnType<typeof supabaseAdmin>,
  current: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  tokens: Awaited<ReturnType<typeof exchangeCode>>,
  user: Awaited<ReturnType<typeof fetchTwitchUser>>,
) {
  const result = await linkTwitchToStream({
    sb,
    streamId: current.streamId,
    accountId: current.accountId,
    tokens,
    user,
  });
  const back = (qs: string) =>
    new NextResponse(null, {
      status: 302,
      headers: { Location: new URL(`/setup?${qs}`, req.url).toString() },
    });
  if (!result.ok) return back(`twitch=${result.reason}`);

  await syncModeratorRows(sb, tokens.access_token, user);

  if ((tokens.scope || []).includes('user:read:chat')) {
    createChatSubscription(user.id).catch((err) =>
      console.error('EventSub subscription failed:', err),
    );
  }

  const session = buildSessionCookie({
    streamId: current.streamId,
    accountId: user.id, // canonical id is the Twitch id once linked
    twitchUserId: user.id,
    twitchLogin: user.login,
    displayName: user.display_name,
    role: 'streamer',
  });
  const response = back('twitch=linked');
  response.cookies.set(session.name, session.value, session.options);
  return response;
}
