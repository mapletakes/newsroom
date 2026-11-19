import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };

const state = vi.hoisted(() => ({
  access: {} as Record<string, unknown>,
  // Each query the route awaits takes the next result, in order.
  queue: [] as unknown[],
  calls: [] as [string, unknown[]][],
  limited: false,
  twitchUser: null as null | { id: string; login: string; display_name: string },
}));

vi.mock('@/lib/suspicious-log-access', () => ({
  getSuspiciousLogAccess: vi.fn(async () => state.access),
}));
vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn(async () => (state.limited ? { ok: false, retryAfterSeconds: 60 } : { ok: true })),
  hashKey: (s: string) => s,
}));
vi.mock('@/lib/chatter-flags', async (orig) => ({
  ...(await orig<typeof import('@/lib/chatter-flags')>()),
  lookupTwitchUser: vi.fn(async () => state.twitchUser),
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      state.calls.push(['from', [table]]);
      const next = () => (state.queue.shift() ?? { data: null, error: null }) as Result;
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'lt', 'gt', 'order', 'limit', 'in', 'insert', 'update', 'upsert', 'delete']) {
        chain[method] = (...args: unknown[]) => {
          state.calls.push([method, args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => void) => resolve(next());
      chain.single = async () => next();
      chain.maybeSingle = async () => next();
      return chain;
    },
  }),
}));

import { DELETE, GET, PATCH, POST } from './route';
import { CONTEXT_REQUIRED } from '@/lib/chatter-flags';

const MSG = '4b4dbeb8-77ce-4eec-96ef-fba4bda9693c';
const MSG2 = '5b4dbeb8-77ce-4eec-96ef-fba4bda9693c';
const FLAG = '9c2d3e1f-1111-4222-8333-444455556666';
const base = { ok: true, streamId: 's1', logEnabled: true, logStatus: 'active', logStatusAt: null };
const streamer = { ...base, role: 'streamer', userId: '100', userLogin: 'streamer' };
const mod = { ...base, role: 'mod', userId: '200', userLogin: 'themod' };

const request = (method: string, body?: unknown, query = '') =>
  new NextRequest(`http://localhost/api/suspicious-log/flags${query}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const post = (body: unknown) => POST(request('POST', body));
const patch = (body: unknown) => PATCH(request('PATCH', body));
const del = (body: unknown) => DELETE(request('DELETE', body));
const called = (method: string) => state.calls.filter(([name]) => name === method).map(([, args]) => args);

const message = (id: string, chatter = '900') => ({
  id,
  chatter_user_id: chatter,
  chatter_login: 'troll',
  chatter_name: 'Troll',
});

beforeEach(() => {
  state.access = mod;
  state.queue = [];
  state.calls = [];
  state.limited = false;
  state.twitchUser = null;
});

afterEach(() => vi.clearAllMocks());

describe('POST /api/suspicious-log/flags', () => {
  it.each([
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['reconnect', 403],
    ['twitch', 503],
  ])('refuses %s without touching the database', async (reason, status) => {
    state.access = { ok: false, reason };
    expect((await post({ chatterId: '900', category: 'spam', messageIds: [MSG] })).status).toBe(status);
    expect(state.calls).toEqual([]);
  });

  it('refuses while the module is off, even for the streamer', async () => {
    state.access = { ...streamer, logEnabled: false };
    expect((await post({ chatterId: '900', category: 'spam', messageIds: [MSG] })).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it('explains that context is needed when nothing is attached', async () => {
    const res = await post({ chatterId: '900', category: 'spam' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: CONTEXT_REQUIRED });
    expect(state.calls).toEqual([]);
  });

  it('is rate limited per person', async () => {
    state.limited = true;
    expect((await post({ chatterId: '900', category: 'spam', messageIds: [MSG] })).status).toBe(429);
    expect(state.calls).toEqual([]);
  });

  it('flags a chatter with their log messages, recording who made it', async () => {
    state.queue = [
      { data: [message(MSG), message(MSG2)] }, // the channel's messages
      {}, // expired flags cleared
      { data: null }, // no live flag yet
      { data: { id: FLAG } }, // insert
      {}, // message links
    ];
    const res = await post({ chatterId: '900', category: 'harassment', context: ' kept going ', messageIds: [MSG, MSG2] });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ flag: { id: FLAG, chatterName: 'Troll' } });

    const [flagInsert, linkInsert] = called('insert');
    expect(flagInsert[0]).toMatchObject({
      stream_id: 's1',
      chatter_user_id: '900',
      chatter_login: 'troll',
      category: 'harassment',
      context: 'kept going',
      created_by_id: '200',
      created_by_login: 'themod',
    });
    expect(linkInsert[0]).toEqual([
      { flag_id: FLAG, message_id: MSG },
      { flag_id: FLAG, message_id: MSG2 },
    ]);
    // Only this channel's messages can back a flag.
    expect(called('eq')).toContainEqual(['stream_id', 's1']);
  });

  it('refuses messages from more than one chatter', async () => {
    state.queue = [{ data: [message(MSG), message(MSG2, '901')] }];
    expect((await post({ chatterId: '900', category: 'spam', messageIds: [MSG, MSG2] })).status).toBe(400);
    expect(called('insert')).toEqual([]);
  });

  it('refuses messages that are not this chatter’s', async () => {
    state.queue = [{ data: [message(MSG, '901')] }];
    expect((await post({ chatterId: '900', category: 'spam', messageIds: [MSG] })).status).toBe(400);
  });

  it('points at the existing flag instead of making a second', async () => {
    state.queue = [{ data: [message(MSG)] }, {}, { data: { id: FLAG } }];
    const res = await post({ chatterId: '900', category: 'spam', messageIds: [MSG] });
    expect(res.status).toBe(409);
    expect((await res.json()).flagId).toBe(FLAG);
    expect(called('insert')).toEqual([]);
  });

  it('flags someone who was never in the log by username', async () => {
    state.twitchUser = { id: '777', login: 'troll', display_name: 'Troll' };
    state.queue = [{}, { data: null }, { data: { id: FLAG } }];
    const res = await post({ login: 'Troll', category: 'ban_evasion', context: 'Banned last week for slurs.' });
    expect(res.status).toBe(201);
    expect(called('insert')).toHaveLength(1);
    expect(called('insert')[0][0]).toMatchObject({ chatter_user_id: '777', context: 'Banned last week for slurs.' });
  });

  it('says so when the username has no Twitch account', async () => {
    const res = await post({ login: 'nobody', category: 'spam', context: 'x' });
    expect(res.status).toBe(404);
    expect(called('insert')).toEqual([]);
  });

  it('takes the flag back out if its messages could not be attached', async () => {
    state.queue = [{ data: [message(MSG)] }, {}, { data: null }, { data: { id: FLAG } }, { error: { message: 'boom' } }];
    expect((await post({ chatterId: '900', category: 'spam', messageIds: [MSG] })).status).toBe(500);
    expect(called('delete').length).toBe(2); // expired sweep, then the rollback
    expect(called('eq')).toContainEqual(['id', FLAG]);
  });
});

describe('PATCH /api/suspicious-log/flags', () => {
  const live = (over: Record<string, unknown> = {}) => ({
    data: {
      id: FLAG,
      chatter_user_id: '900',
      context: 'what happened',
      created_by_id: '300',
      withdrawn_at: null,
      expires_at: '2999-01-01T00:00:00Z',
      ...over,
    },
  });

  it('lets any mod add evidence to a teammate’s flag', async () => {
    state.queue = [live(), { count: 1 }, { data: [message(MSG)] }, {}, {}];
    const res = await patch({ id: FLAG, addMessageIds: [MSG] });
    expect(res.status).toBe(200);
    expect(called('upsert')[0][0]).toEqual([{ flag_id: FLAG, message_id: MSG }]);
  });

  it('only lets the streamer or the flag’s maker reword it', async () => {
    state.queue = [live()];
    expect((await patch({ id: FLAG, context: 'new words' })).status).toBe(403);

    state.access = streamer;
    state.queue = [live(), { count: 1 }, {}];
    expect((await patch({ id: FLAG, context: 'new words' })).status).toBe(200);
    expect(called('update').at(-1)?.[0]).toMatchObject({ context: 'new words' });
  });

  it('won’t empty the context of a flag with no messages', async () => {
    state.access = streamer;
    state.queue = [live(), { count: 0 }];
    const res = await patch({ id: FLAG, context: '' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: CONTEXT_REQUIRED });
  });

  it('treats a withdrawn or expired flag as gone', async () => {
    state.queue = [live({ withdrawn_at: '2026-11-01T00:00:00Z' })];
    expect((await patch({ id: FLAG, addMessageIds: [MSG] })).status).toBe(404);
    state.queue = [live({ expires_at: '2020-01-01T00:00:00Z' })];
    expect((await patch({ id: FLAG, addMessageIds: [MSG] })).status).toBe(404);
  });
});

describe('DELETE /api/suspicious-log/flags', () => {
  it('limits a mod to their own flags', async () => {
    state.queue = [{ data: [{ id: FLAG }] }];
    expect((await del({ id: FLAG })).status).toBe(200);
    expect(called('eq')).toContainEqual(['created_by_id', '200']);
  });

  it('lets the streamer withdraw any flag, even with the module off', async () => {
    state.access = { ...streamer, logEnabled: false };
    state.queue = [{ data: [{ id: FLAG }] }];
    expect((await del({ id: FLAG })).status).toBe(200);
    expect(called('eq')).not.toContainEqual(['created_by_id', '100']);
  });

  it('is a 404 when nothing matched', async () => {
    state.queue = [{ data: [] }];
    expect((await del({ id: FLAG })).status).toBe(404);
  });
});

describe('GET /api/suspicious-log/flags', () => {
  it('lists the channel’s flags with their messages, without the maker’s id', async () => {
    state.queue = [
      {
        data: [
          {
            id: FLAG,
            chatter_user_id: '900',
            chatter_login: 'troll',
            chatter_name: 'Troll',
            category: 'spam',
            context: '',
            created_by_id: '200',
            created_by_login: 'themod',
            created_at: '2026-11-19T00:00:00Z',
            updated_at: null,
            withdrawn_at: null,
            expires_at: '2999-01-01T00:00:00Z',
            chatter_flag_messages: [
              { suspicious_messages: { id: MSG2, sent_at: '2026-11-18T02:00:00Z', message_text: 'b', low_trust_status: 'restricted' } },
              { suspicious_messages: { id: MSG, sent_at: '2026-11-18T01:00:00Z', message_text: 'a', low_trust_status: 'restricted' } },
              { suspicious_messages: null },
            ],
          },
        ],
      },
    ];
    const res = await GET(request('GET'));
    const { flags } = await res.json();
    expect(flags[0]).toMatchObject({ status: 'active', mine: true, canEdit: true, created_by_login: 'themod' });
    expect(flags[0]).not.toHaveProperty('created_by_id');
    expect(flags[0].messages.map((m: { id: string }) => m.id)).toEqual([MSG, MSG2]);
  });
});
