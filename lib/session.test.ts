import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildSessionCookie,
  parseSessionCookie,
  signOAuthState,
  verifyOAuthState,
  verifyOAuthStateDetailed,
  type Session,
} from './session';

const SESSION: Session = {
  streamId: 'stream-1',
  twitchUserId: '12345',
  twitchLogin: 'someuser',
  displayName: 'SomeUser',
  role: 'streamer',
};

describe('session cookie sign/verify', () => {
  it('round-trips a valid session', () => {
    const { value } = buildSessionCookie(SESSION);
    expect(parseSessionCookie(value)).toEqual(SESSION);
  });

  it('sets the expected cookie attributes', () => {
    const cookie = buildSessionCookie(SESSION);
    expect(cookie.name).toBe('newsroom_session');
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe('lax');
    expect(cookie.options.path).toBe('/');
    expect(cookie.options.maxAge).toBe(60 * 60 * 24 * 30);
  });

  it('rejects a tampered payload', () => {
    const { value } = buildSessionCookie(SESSION);
    const [payload, sig] = value.split('.');
    // Flip the role to escalate privilege — must not verify.
    const tampered = Buffer.from(payload, 'base64url').toString('utf8').replace('streamer', 'mod');
    const tamperedPayload = Buffer.from(tampered).toString('base64url');
    expect(parseSessionCookie(`${tamperedPayload}.${sig}`)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const { value } = buildSessionCookie(SESSION);
    const [payload, sig] = value.split('.');
    const flipped = sig.slice(0, -1) + (sig.at(-1) === 'a' ? 'b' : 'a');
    expect(parseSessionCookie(`${payload}.${flipped}`)).toBeNull();
  });

  it('rejects malformed or missing values', () => {
    expect(parseSessionCookie(undefined)).toBeNull();
    expect(parseSessionCookie('')).toBeNull();
    expect(parseSessionCookie('no-dot-here')).toBeNull();
    expect(parseSessionCookie('payload.')).toBeNull();
    expect(parseSessionCookie('.sig')).toBeNull();
  });
});

describe('OAuth state sign/verify', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a freshly signed state', () => {
    const state = signOAuthState();
    expect(verifyOAuthState(state)).toBe(true);
    expect(verifyOAuthStateDetailed(state)).toMatchObject({ valid: true, reason: 'ok' });
  });

  it('rejects a state with the wrong number of parts', () => {
    expect(verifyOAuthStateDetailed('a.b')).toMatchObject({ valid: false, reason: 'bad-parts' });
    expect(verifyOAuthStateDetailed('a.b.c.d')).toMatchObject({ valid: false, reason: 'bad-parts' });
  });

  it('rejects a tampered signature', () => {
    const state = signOAuthState();
    const parts = state.split('.');
    parts[2] = parts[2].slice(0, -1) + (parts[2].at(-1) === 'a' ? 'b' : 'a');
    expect(verifyOAuthStateDetailed(parts.join('.'))).toMatchObject({
      valid: false,
      reason: 'bad-sig',
    });
  });

  it('rejects a state older than 30 minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const state = signOAuthState();

    vi.setSystemTime(new Date('2026-01-01T00:31:00Z')); // 31 min later
    expect(verifyOAuthStateDetailed(state)).toMatchObject({ valid: false, reason: 'expired' });
  });

  it('accepts a state right up to the 30 minute boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const state = signOAuthState();

    vi.setSystemTime(new Date('2026-01-01T00:29:59Z')); // just under 30 min
    expect(verifyOAuthStateDetailed(state)).toMatchObject({ valid: true, reason: 'ok' });
  });

  it('rejects a state that claims to be from more than 30s in the future', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    const state = signOAuthState();

    // Verifying "earlier" than the state's own timestamp simulates clock skew.
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    expect(verifyOAuthStateDetailed(state)).toMatchObject({ valid: false, reason: 'future' });
  });

  it('tolerates small negative clock skew (under 30s)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:20Z'));
    const state = signOAuthState();

    vi.setSystemTime(new Date('2026-01-01T00:00:00Z')); // 20s of skew
    expect(verifyOAuthStateDetailed(state)).toMatchObject({ valid: true, reason: 'ok' });
  });
});
