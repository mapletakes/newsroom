import { NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/twitch-oauth';
import { signOAuthState } from '@/lib/session';

export async function GET() {
  const state = signOAuthState();
  console.log('[oauth start] state generated', {
    statePrefix: state.slice(0, 30),
    secretKeyPrefix: (process.env.TWITCH_CLIENT_SECRET || '').slice(0, 4) + '...',
  });
  return new NextResponse(null, {
    status: 302,
    headers: { Location: buildAuthUrl(state) },
  });
}
