import { cookies } from 'next/headers';
import crypto from 'crypto';

const COOKIE = 'newsroom_session';

function getSecret(): string {
  // In prod, set TWITCH_CLIENT_SECRET (already required). We reuse it as
  // signing key for MVP; rotate by adding NEWSROOM_SESSION_SECRET if needed.
  return process.env.NEWSROOM_SESSION_SECRET || process.env.TWITCH_CLIENT_SECRET || 'dev-secret';
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

export type Session = {
  streamId: string;
  twitchUserId: string;
  twitchLogin: string;
  displayName: string;
  role: 'streamer' | 'mod';
};

export function buildSessionCookie(s: Session) {
  const payload = Buffer.from(JSON.stringify(s)).toString('base64url');
  const sig = sign(payload);
  return {
    name: COOKIE,
    value: `${payload}.${sig}`,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    },
  };
}

export async function getSession(): Promise<Session | null> {
  const c = cookies().get(COOKIE);
  if (!c) return null;
  const [payload, sig] = c.value.split('.');
  if (!payload || !sig) return null;
  if (sign(payload) !== sig) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch { return null; }
}

export function signOAuthState(): string {
  const ts = Date.now().toString(36);
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `${ts}.${nonce}`;
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function verifyOAuthState(state: string): boolean {
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  if (sign(`${ts}.${nonce}`) !== sig) return false;
  const age = Date.now() - parseInt(ts, 36);
  return age >= 0 && age < 600_000; // valid for 10 minutes
}

export async function clearSession() {
  cookies().delete(COOKIE);
}
