import { NextRequest, NextResponse } from 'next/server';
import { getSession, buildSessionCookie } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json();
  const streamId = String(body.streamId || '');
  const role = body.role === 'mod' ? 'mod' as const : 'streamer' as const;
  if (!streamId) return NextResponse.json({ error: 'missing streamId' }, { status: 400 });

  const sb = supabaseAdmin();

  // Verify access: either it's their own stream, or they're a registered mod
  const { data: stream } = await sb
    .from('streams')
    .select('id, twitch_login, display_name')
    .eq('id', streamId)
    .single();
  if (!stream) return NextResponse.json({ error: 'stream not found' }, { status: 404 });

  if (role === 'mod') {
    const { data: modRow } = await sb
      .from('moderators')
      .select('stream_id')
      .eq('stream_id', streamId)
      .eq('twitch_user_id', session.twitchUserId)
      .maybeSingle();
    if (!modRow) return NextResponse.json({ error: 'not a mod for this stream' }, { status: 403 });
  } else {
    // Streamer must own this stream
    const { data: ownStream } = await sb
      .from('streams')
      .select('id')
      .eq('id', streamId)
      .eq('twitch_user_id', session.twitchUserId)
      .maybeSingle();
    if (!ownStream) return NextResponse.json({ error: 'not your stream' }, { status: 403 });
  }

  const newSession = buildSessionCookie({
    streamId,
    twitchUserId: session.twitchUserId,
    twitchLogin: session.twitchLogin,
    displayName: session.displayName,
    role,
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(newSession.name, newSession.value, newSession.options);
  return response;
}
