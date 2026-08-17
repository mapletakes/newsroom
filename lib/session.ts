import { cookies } from 'next/headers';
import crypto from 'crypto';
import { supabaseAdmin } from './supabase';

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

/** Verify + decode a raw session cookie value. Pulled out of getSession() so the
 *  signing/tamper-detection logic is testable without a request context. */
export function parseSessionCookie(value: string | undefined): Session | null {
  if (!value) return null;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return null;
  if (sign(payload) !== sig) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch { return null; }
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  return parseSessionCookie(cookieStore.get(COOKIE)?.value);
}

/**
 * Like getSession(), but also checks the acted-upon stream (session.streamId)
 * hasn't been blocked/unapproved — page routes redirect to /blocked, but that
 * doesn't stop the same session's API calls, so mutating endpoints should use
 * this instead of getSession(). Deliberately not folded into getSession()
 * itself: that would add a DB round-trip to every page render and read-only
 * call in the app for a check that only matters on writes.
 */
export async function getApprovedSession(): Promise<Session | null> {
  const session = await getSession();
  if (!session) return null;
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('streams')
    .select('approved')
    .eq('id', session.streamId)
    .maybeSingle();
  if (data?.approved === false) return null;
  return session;
}

export function signOAuthState(): string {
  const ts = Date.now().toString(36);
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `${ts}.${nonce}`;
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function verifyOAuthState(state: string): boolean {
  return verifyOAuthStateDetailed(state).valid;
}

/** Same as verifyOAuthState but returns the failure reason for diagnostics. */
export function verifyOAuthStateDetailed(state: string): {
  valid: boolean;
  reason: 'ok' | 'bad-parts' | 'bad-sig' | 'future' | 'expired';
  ageMs?: number;
} {
  const parts = state.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'bad-parts' };
  const [ts, nonce, sig] = parts;
  if (sign(`${ts}.${nonce}`) !== sig) return { valid: false, reason: 'bad-sig' };
  const age = Date.now() - parseInt(ts, 36);
  // Allow small negative skew across regions; reject anything clearly from the future.
  if (age < -30_000) return { valid: false, reason: 'future', ageMs: age };
  if (age >= 1_800_000) return { valid: false, reason: 'expired', ageMs: age }; // 30 min
  return { valid: true, reason: 'ok', ageMs: age };
}

export async function clearSession() {
  cookies().delete(COOKIE);
}
