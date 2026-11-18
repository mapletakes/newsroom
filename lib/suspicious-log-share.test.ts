import { describe, expect, it } from 'vitest';
import {
  SHARED_LOG_LIMIT,
  SHARE_TOKEN_RE,
  loadSharedLog,
  newShareToken,
  parseShareRequest,
  shareExpiry,
  shareStatus,
} from './suspicious-log-share';

const ID_A = '4b4dbeb8-77ce-4eec-96ef-fba4bda9693c';
const ID_B = '900013a7-1f0b-4678-8c17-f8cd0e42e55c';
const TOKEN = `sl_${'a'.repeat(48)}`;
const NOW = Date.parse('2026-11-18T20:00:00Z');
const HOUR = 3_600_000;

describe('newShareToken', () => {
  it('is long, random and recognisable', () => {
    const a = newShareToken();
    expect(a).toMatch(SHARE_TOKEN_RE);
    expect(newShareToken()).not.toBe(a);
  });
});

describe('parseShareRequest', () => {
  it('accepts selected messages and drops duplicate ids', () => {
    expect(parseShareRequest({ kind: 'messages', messageIds: [ID_A, ID_B, ID_A] })).toEqual({
      kind: 'messages',
      messageIds: [ID_A, ID_B],
    });
  });

  it('accepts a chatter by id', () => {
    expect(parseShareRequest({ kind: 'chatter', chatterId: '12345' })).toEqual({ kind: 'chatter', chatterId: '12345' });
  });

  it.each([
    ['nothing', null],
    ['a string', 'messages'],
    ['an unknown kind', { kind: 'everything' }],
    ['no ids', { kind: 'messages', messageIds: [] }],
    ['ids that are not a list', { kind: 'messages', messageIds: ID_A }],
    ['an id that is not a uuid', { kind: 'messages', messageIds: [ID_A, 'nope'] }],
    ['too many ids', { kind: 'messages', messageIds: Array.from({ length: 201 }, (_, i) => `${i.toString(16).padStart(8, '0')}-1111-4222-8333-444455556666`) }],
    ['a chatter id that is not digits', { kind: 'chatter', chatterId: '12; drop' }],
    ['a chatter with no id', { kind: 'chatter' }],
  ])('rejects %s', (_label, body) => {
    expect(parseShareRequest(body)).toBeNull();
  });
});

describe('share lifetime', () => {
  it('expires thirty days out', () => {
    expect(Date.parse(shareExpiry(NOW)) - NOW).toBe(30 * 24 * HOUR);
  });

  it('judges a link active, expired or revoked', () => {
    const future = new Date(NOW + HOUR).toISOString();
    const past = new Date(NOW - HOUR).toISOString();
    expect(shareStatus({ expires_at: future, revoked_at: null }, NOW)).toBe('active');
    expect(shareStatus({ expires_at: past, revoked_at: null }, NOW)).toBe('expired');
    expect(shareStatus({ expires_at: future, revoked_at: past }, NOW)).toBe('revoked');
  });

  it('treats the expiry instant itself as expired', () => {
    expect(shareStatus({ expires_at: new Date(NOW).toISOString(), revoked_at: null }, NOW)).toBe('expired');
  });
});

type Message = { id: string; sent_at: string; chatter_name: string; message_text: string; low_trust_status: string };

const message = (id: string, sentAt: string, text = 'hi'): Message => ({
  id,
  sent_at: sentAt,
  chatter_name: 'Viewer',
  message_text: text,
  low_trust_status: 'restricted',
});

function fakeDb(opts: {
  share?: Record<string, unknown> | null;
  stream?: Record<string, unknown> | null;
  messages?: Message[];
  error?: { message: string } | null;
}) {
  const calls: [string, unknown[]][] = [];
  const share =
    opts.share === undefined
      ? {
          stream_id: 's1',
          kind: 'messages',
          message_ids: [ID_A, ID_B],
          chatter_user_id: null,
          label: 'Viewer',
          created_at: new Date(NOW - 2 * HOUR).toISOString(),
          expires_at: new Date(NOW + HOUR).toISOString(),
          revoked_at: null,
        }
      : opts.share;
  const stream = opts.stream === undefined ? { display_name: 'Channel', twitch_login: 'channel', approved: true } : opts.stream;

  const sb = {
    from: (table: string) => {
      calls.push(['from', [table]]);
      let ids: string[] | null = null;
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'lte', 'order', 'limit']) {
        chain[method] = (...args: unknown[]) => {
          calls.push([method, args]);
          return chain;
        };
      }
      chain.in = (...args: unknown[]) => {
        calls.push(['in', args]);
        ids = args[1] as string[];
        return chain;
      };
      chain.maybeSingle = async () => ({
        data: table === 'suspicious_shares' ? share : stream,
        error: opts.error ?? null,
      });
      chain.then = (resolve: (v: unknown) => void) =>
        resolve({
          data: (opts.messages ?? []).filter((m) => !ids || ids.includes(m.id)),
          error: opts.error ?? null,
        });
      return chain;
    },
  };
  return { sb: sb as never, calls };
}

const called = (calls: [string, unknown[]][], method: string) =>
  calls.filter(([name]) => name === method).map(([, args]) => args);

describe('loadSharedLog', () => {
  it('does not touch the database for something that is not a token', async () => {
    const { sb, calls } = fakeDb({});
    expect(await loadSharedLog(sb, 'not-a-token', NOW)).toBeNull();
    expect(await loadSharedLog(sb, `sl_${'G'.repeat(48)}`, NOW)).toBeNull();
    expect(calls).toEqual([]);
  });

  it.each([
    ['an unknown link', { share: null }],
    ['a revoked link', { share: { revoked_at: new Date(NOW - HOUR).toISOString(), expires_at: new Date(NOW + HOUR).toISOString() } }],
    ['an expired link', { share: { revoked_at: null, expires_at: new Date(NOW - HOUR).toISOString() } }],
    ['a blocked channel', { stream: { display_name: 'Channel', twitch_login: 'channel', approved: false } }],
    ['a missing channel', { stream: null }],
  ])('shows nothing for %s', async (_label, opts) => {
    const { sb, calls } = fakeDb({ messages: [message(ID_A, '2026-11-18T10:00:00Z')], ...opts });
    expect(await loadSharedLog(sb, TOKEN, NOW)).toBeNull();
    expect(called(calls, 'from').some(([table]) => table === 'suspicious_messages')).toBe(false);
  });

  it('shows selected messages oldest first, with only what a reader needs', async () => {
    const { sb } = fakeDb({
      messages: [message(ID_B, '2026-11-18T11:00:00Z', 'second'), message(ID_A, '2026-11-18T10:00:00Z', 'first')],
    });

    const log = await loadSharedLog(sb, TOKEN, NOW);

    expect(log).toMatchObject({ label: 'Viewer', channelName: 'Channel', truncated: false });
    expect(log?.messages).toEqual([
      { sent_at: '2026-11-18T10:00:00Z', chatter_name: 'Viewer', message_text: 'first', low_trust_status: 'restricted' },
      { sent_at: '2026-11-18T11:00:00Z', chatter_name: 'Viewer', message_text: 'second', low_trust_status: 'restricted' },
    ]);
    // Nothing that identifies the chatter beyond their name, or who flagged them.
    expect(JSON.stringify(log)).not.toMatch(/"id"|chatter_user_id|created_by|moderator/);
  });

  it('leaves out a message that has since been deleted', async () => {
    const { sb } = fakeDb({ messages: [message(ID_A, '2026-11-18T10:00:00Z', 'kept')] });
    expect((await loadSharedLog(sb, TOKEN, NOW))?.messages.map((m) => m.message_text)).toEqual(['kept']);
  });

  it('asks for a long selection in small batches', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `${i.toString(16).padStart(8, '0')}-1111-4222-8333-444455556666`);
    const { sb, calls } = fakeDb({
      share: {
        stream_id: 's1',
        kind: 'messages',
        message_ids: ids,
        chatter_user_id: null,
        label: 'Selected messages',
        created_at: new Date(NOW - HOUR).toISOString(),
        expires_at: new Date(NOW + HOUR).toISOString(),
        revoked_at: null,
      },
      messages: ids.map((id, i) => message(id, new Date(NOW - 10 * HOUR + i * 1000).toISOString())),
    });

    const log = await loadSharedLog(sb, TOKEN, NOW);

    expect(called(calls, 'in').map(([, batch]) => (batch as string[]).length)).toEqual([50, 50, 20]);
    expect(log?.messages).toHaveLength(120);
  });

  it('shows a chatter\'s messages only up to when the link was made', async () => {
    const createdAt = new Date(NOW - 2 * HOUR).toISOString();
    const { sb, calls } = fakeDb({
      share: {
        stream_id: 's1',
        kind: 'chatter',
        message_ids: [],
        chatter_user_id: '300',
        label: 'Viewer',
        created_at: createdAt,
        expires_at: new Date(NOW + HOUR).toISOString(),
        revoked_at: null,
      },
      messages: [message(ID_A, '2026-11-18T10:00:00Z')],
    });

    await loadSharedLog(sb, TOKEN, NOW);

    expect(called(calls, 'eq')).toContainEqual(['chatter_user_id', '300']);
    expect(called(calls, 'eq')).toContainEqual(['stream_id', 's1']);
    expect(called(calls, 'lte')).toContainEqual(['sent_at', createdAt]);
  });

  it('says so when a link covers more than it will show', async () => {
    const { sb } = fakeDb({
      share: {
        stream_id: 's1',
        kind: 'chatter',
        message_ids: [],
        chatter_user_id: '300',
        label: 'Viewer',
        created_at: new Date(NOW - HOUR).toISOString(),
        expires_at: new Date(NOW + HOUR).toISOString(),
        revoked_at: null,
      },
      messages: Array.from({ length: SHARED_LOG_LIMIT + 1 }, (_, i) => message(`id-${i}`, '2026-11-18T10:00:00Z')),
    });

    const log = await loadSharedLog(sb, TOKEN, NOW);

    expect(log?.truncated).toBe(true);
    expect(log?.messages).toHaveLength(SHARED_LOG_LIMIT);
  });

  it('falls back to a generic channel name', async () => {
    const { sb } = fakeDb({ stream: { display_name: null, twitch_login: null, approved: true } });
    expect((await loadSharedLog(sb, TOKEN, NOW))?.channelName).toBe('A channel');
  });

  it('throws on a database failure rather than calling the link expired', async () => {
    const { sb } = fakeDb({ error: { message: 'down' } });
    await expect(loadSharedLog(sb, TOKEN, NOW)).rejects.toThrow(/down/);
  });
});
