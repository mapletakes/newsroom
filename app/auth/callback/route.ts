import { NextRequest, NextResponse } from 'next/server';
import { buildSessionCookie } from '@/lib/session';
import { verifyMagicLink, findOrCreateEmailStream } from '@/lib/auth-email';

// Landing point for the emailed sign-in link (see the Supabase email template:
// {{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email). Never cacheable.
export const dynamic = 'force-dynamic';

const fail = (req: NextRequest, error: string) =>
  new NextResponse(null, {
    status: 302,
    headers: { Location: new URL(`/login?error=${error}`, req.url).toString() },
  });

export async function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get('token_hash');
  if (!tokenHash) return fail(req, 'link');

  try {
    const user = await verifyMagicLink(tokenHash);
    if (!user) return fail(req, 'link'); // expired, already used, or malformed

    const { stream } = await findOrCreateEmailStream(user);

    // Once Twitch has been linked, signing in by email must give the same
    // identity as signing in with Twitch (same account id, same chat access) —
    // otherwise the two entrances would behave like two different accounts.
    const session = buildSessionCookie({
      streamId: stream.id,
      accountId: stream.twitch_user_id ?? user.id,
      ...(stream.twitch_user_id
        ? { twitchUserId: stream.twitch_user_id, twitchLogin: stream.twitch_login ?? undefined }
        : {}),
      displayName: stream.display_name || user.email.split('@')[0],
      role: 'streamer',
    });
    const response = new NextResponse(null, {
      status: 302,
      headers: { Location: new URL('/deck', req.url).toString() },
    });
    response.cookies.set(session.name, session.value, session.options);
    return response;
  } catch (err) {
    console.error('Email sign-in failed:', err);
    return fail(req, 'oauth');
  }
}
