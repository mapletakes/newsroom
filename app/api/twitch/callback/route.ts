import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCode, fetchTwitchUser } from '@/lib/twitch-oauth';
import { supabaseAdmin } from '@/lib/supabase';
import { buildSessionCookie } from '@/lib/session';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const stored = cookies().get('newsroom_oauth_state')?.value;
  if (!code || !state || !stored || state !== stored) {
    return NextResponse.redirect(new URL('/login?error=state', req.url));
  }

  try {
    const tokens = await exchangeCode(code);
    const user = await fetchTwitchUser(tokens.access_token);

    const sb = supabaseAdmin();
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

    const session = buildSessionCookie({
      streamId: stream.id,
      twitchUserId: user.id,
      twitchLogin: user.login,
      displayName: user.display_name,
      role: 'streamer',
    });

    const response = new NextResponse(null, {
      status: 302,
      headers: { Location: new URL('/deck', req.url).toString() },
    });
    response.cookies.set(session.name, session.value, session.options);
    response.cookies.set('newsroom_oauth_state', '', { path: '/', maxAge: 0 });
    return response;
  } catch (err) {
    console.error(err);
    return new NextResponse(null, {
      status: 302,
      headers: { Location: new URL('/login?error=oauth', req.url).toString() },
    });
  }
}
