import { NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/twitch-oauth';
import { NextRequest } from 'next/server';
import { getSession, signOAuthState } from '@/lib/session';

// Never cache: every request must mint a fresh, unexpired OAuth state.
// Without this the CDN caches the 302 (and the state baked into it), so
// after the state's expiry window everyone gets a stale, rejected state.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // ?link=1 only means something for a signed-in account that has no Twitch
  // identity yet (email sign-in); anyone else just gets the normal login.
  let link = false;
  if (req.nextUrl.searchParams.get('link') === '1') {
    const session = await getSession();
    link = !!session && session.role === 'streamer' && !session.twitchUserId;
  }
  const state = signOAuthState({ link });
  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: buildAuthUrl(state),
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
