import { NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/twitch-oauth';
import { signOAuthState } from '@/lib/session';

// Never cache: every request must mint a fresh, unexpired OAuth state.
// Without this the CDN caches the 302 (and the state baked into it), so
// after the state's expiry window everyone gets a stale, rejected state.
export const dynamic = 'force-dynamic';

export async function GET() {
  const state = signOAuthState();
  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: buildAuthUrl(state),
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
