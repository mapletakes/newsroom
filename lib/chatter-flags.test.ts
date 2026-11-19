import { describe, expect, it } from 'vitest';
import {
  CONTEXT_REQUIRED,
  flagExpiry,
  flagStatus,
  groupNetworkFlags,
  matchesNetworkFilter,
  parseCreateFlag,
  parseUpdateFlag,
  type NetworkFlagRow,
} from './chatter-flags';
import { MAX_FLAG_CONTEXT, MAX_FLAG_MESSAGES, parseNetworkFilter } from './chatter-flag-types';

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
  it('reads an admin removal before anything else', () => {
    expect(
      flagStatus({ removed_at: '2026-11-01T00:00:00Z', withdrawn_at: '2026-11-02T00:00:00Z', expires_at: flagExpiry(now) }, now),
    ).toBe('removed');
  });
  it('reads withdrawn before expired', () => {
    expect(flagStatus({ withdrawn_at: '2026-01-01T00:00:00Z', expires_at: '2020-01-01T00:00:00Z' }, now)).toBe('withdrawn');
  });
  it('expires a year out', () => {
    expect(flagExpiry(now)).toBe('2027-11-19T12:00:00.000Z');
  });
});

describe('groupNetworkFlags', () => {
  const row = (over: Partial<NetworkFlagRow> = {}): NetworkFlagRow => ({
    id: 'f1',
    chatter_user_id: '900',
    chatter_login: 'troll',
    chatter_name: 'Troll',
    category: 'harassment',
    context: '',
    created_by_login: 'moda',
    created_at: '2026-11-10T00:00:00Z',
    updated_at: null,
    streams: { display_name: 'ChannelA', twitch_login: 'channela', approved: true },
    chatter_flag_messages: [],
    ...over,
  });

  it('groups by chatter, newest first, naming the channel and the flagger', () => {
    const chatters = groupNetworkFlags(
      [
        row({ id: 'f1' }),
        row({ id: 'f2', created_at: '2026-11-12T00:00:00Z', chatter_name: 'Troll2', created_by_login: 'modb', streams: { display_name: null, twitch_login: 'channelb', approved: null } }),
        row({ id: 'f3', chatter_user_id: '901', created_at: '2026-11-11T00:00:00Z' }),
      ],
      [],
      new Set(['901']),
    );
    expect(chatters.map((c) => c.chatter_user_id)).toEqual(['900', '901']);
    expect(chatters[0].flags.map((f) => [f.id, f.channelName, f.flaggedBy])).toEqual([
      ['f2', 'channelb', 'modb'],
      ['f1', 'ChannelA', 'moda'],
    ]);
    expect(chatters[0].chatter_name).toBe('Troll2');
    expect(chatters[0].isNew).toBe(true);
    expect(chatters[1].inMyLog).toBe(true);
    expect(chatters[0].inMyLog).toBe(false);
  });

  it('drops flags from blocked channels', () => {
    expect(groupNetworkFlags([row({ streams: { display_name: 'X', twitch_login: 'x', approved: false } })], [], new Set())).toEqual([]);
  });

  it('is new again when a flag arrives or changes after the review', () => {
    const review = { chatter_user_id: '900', decision: 'dismissed' as const, decided_by_login: 'mod', decided_at: '2026-11-11T00:00:00.5Z' };
    expect(groupNetworkFlags([row()], [review], new Set())[0].isNew).toBe(false);
    expect(groupNetworkFlags([row({ updated_at: '2026-11-11T00:00:01Z' })], [review], new Set())[0].isNew).toBe(true);
    expect(groupNetworkFlags([row(), row({ id: 'f2', created_at: '2026-11-12T00:00:00Z' })], [review], new Set())[0].isNew).toBe(true);
  });

  it('orders messages by when they were said and skips deleted ones', () => {
    const [chatter] = groupNetworkFlags(
      [
        row({
          chatter_flag_messages: [
            { suspicious_messages: { id: 'b', sent_at: '2026-11-09T02:00:00Z', message_text: 'b', low_trust_status: 'restricted' } },
            { suspicious_messages: null },
            { suspicious_messages: { id: 'a', sent_at: '2026-11-09T01:00:00Z', message_text: 'a', low_trust_status: 'restricted' } },
          ],
        }),
      ],
      [],
      new Set(),
    );
    expect(chatter.flags[0].messages.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('filters by review state', () => {
    const [fresh] = groupNetworkFlags([row()], [], new Set());
    const [banned] = groupNetworkFlags(
      [row()],
      [{ chatter_user_id: '900', decision: 'banned', decided_by_login: 'm', decided_at: '2026-11-12T00:00:00Z' }],
      new Set(),
    );
    expect(matchesNetworkFilter(fresh, 'new')).toBe(true);
    expect(matchesNetworkFilter(banned, 'new')).toBe(false);
    expect(matchesNetworkFilter(banned, 'banned')).toBe(true);
    expect(matchesNetworkFilter(banned, 'watching')).toBe(false);
    expect(matchesNetworkFilter(banned, 'all')).toBe(true);
    expect(parseNetworkFilter('bogus')).toBe('new');
    expect(parseNetworkFilter('dismissed')).toBe('dismissed');
  });
});
