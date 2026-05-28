import { NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/twitch-oauth';
import { signOAuthState } from '@/lib/session';

export async function GET() {
  const state = signOAuthState();
  return new NextResponse(null, {
    status: 302,
    headers: { Location: buildAuthUrl(state) },
  });
}
