import { NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/twitch-oauth';
import crypto from 'crypto';

export async function GET() {
  const state = crypto.randomBytes(16).toString('hex');
  const response = new NextResponse(null, {
    status: 302,
    headers: { Location: buildAuthUrl(state) },
  });
  response.cookies.set('newsroom_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return response;
}
