import { describe, expect, it } from 'vitest';
import { CONTEXT_REQUIRED, flagExpiry, flagStatus, parseCreateFlag, parseUpdateFlag } from './chatter-flags';
import { MAX_FLAG_CONTEXT, MAX_FLAG_MESSAGES } from './chatter-flag-types';

const ID = '4b4dbeb8-77ce-4eec-96ef-fba4bda9693c';
const ID2 = '9c2d3e1f-1111-4222-8333-444455556666';

describe('parseCreateFlag', () => {
  it('accepts a chatter from the log with messages and no context', () => {
    expect(parseCreateFlag({ chatterId: '200', category: 'spam', messageIds: [ID, ID] })).toEqual({
      ok: true,
      value: { target: { kind: 'chatter', chatterId: '200' }, category: 'spam', context: '', messageIds: [ID] },
    });
  });

  it('requires context when no messages are attached', () => {
    expect(parseCreateFlag({ chatterId: '200', category: 'spam' })).toEqual({ ok: false, error: CONTEXT_REQUIRED });
    expect(parseCreateFlag({ login: 'troll', category: 'hate', context: '   \n ' })).toEqual({
      ok: false,
      error: CONTEXT_REQUIRED,
    });
  });

  it('accepts a username with context, normalising it', () => {
    const result = parseCreateFlag({ login: ' @Troll_99 ', category: 'hate', context: ' banned\r\nfor slurs ' });
    expect(result).toEqual({
      ok: true,
      value: { target: { kind: 'login', login: 'troll_99' }, category: 'hate', context: 'banned\nfor slurs', messageIds: [] },
    });
  });

  it('rejects messages with a username, since they can only come from the log', () => {
    expect(parseCreateFlag({ login: 'troll', category: 'hate', context: 'x', messageIds: [ID] }).ok).toBe(false);
  });

  it.each([
    [null],
    [{ category: 'spam', context: 'x' }],
    [{ chatterId: '200', login: 'troll', category: 'spam', context: 'x' }],
    [{ chatterId: 'abc', category: 'spam', context: 'x' }],
    [{ chatterId: '200', category: 'nope', context: 'x' }],
    [{ chatterId: '200', category: 'spam', messageIds: ['nope'] }],
    [{ chatterId: '200', category: 'spam', messageIds: ID }],
  ])('rejects a malformed request %#', (body) => {
    expect(parseCreateFlag(body).ok).toBe(false);
  });

  it('rejects an invalid username with a readable error', () => {
    expect(parseCreateFlag({ login: 'has space', category: 'spam', context: 'x' })).toEqual({
      ok: false,
      error: 'That isn’t a valid Twitch username.',
    });
  });

  it('enforces the context and message limits', () => {
    expect(parseCreateFlag({ login: 'troll', category: 'spam', context: 'x'.repeat(MAX_FLAG_CONTEXT) }).ok).toBe(true);
    expect(parseCreateFlag({ login: 'troll', category: 'spam', context: 'x'.repeat(MAX_FLAG_CONTEXT + 1) }).ok).toBe(false);
    const tooMany = Array.from({ length: MAX_FLAG_MESSAGES + 1 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`);
    expect(parseCreateFlag({ chatterId: '200', category: 'spam', messageIds: tooMany }).ok).toBe(false);
  });
});

describe('parseUpdateFlag', () => {
  it('accepts added messages alone', () => {
    expect(parseUpdateFlag({ id: ID, addMessageIds: [ID2] })).toEqual({
      ok: true,
      value: { id: ID, category: undefined, context: undefined, addMessageIds: [ID2] },
    });
  });

  it('accepts a new category and context', () => {
    expect(parseUpdateFlag({ id: ID, category: 'doxxing', context: ' more ' })).toEqual({
      ok: true,
      value: { id: ID, category: 'doxxing', context: 'more', addMessageIds: [] },
    });
  });

  it.each([[{ id: ID }], [{ id: 'x', context: 'a' }], [{ id: ID, category: 'nope' }], [{ id: ID, context: 5 }]])(
    'rejects %#',
    (body) => {
      expect(parseUpdateFlag(body).ok).toBe(false);
    },
  );
});

describe('flagStatus', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  it('is active until it expires', () => {
    expect(flagStatus({ withdrawn_at: null, expires_at: flagExpiry(now) }, now)).toBe('active');
    expect(flagStatus({ withdrawn_at: null, expires_at: '2026-11-19T11:59:59Z' }, now)).toBe('expired');
  });
  it('reads withdrawn before expired', () => {
    expect(flagStatus({ withdrawn_at: '2026-01-01T00:00:00Z', expires_at: '2020-01-01T00:00:00Z' }, now)).toBe('withdrawn');
  });
  it('expires a year out', () => {
    expect(flagExpiry(now)).toBe('2027-11-19T12:00:00.000Z');
  });
});
