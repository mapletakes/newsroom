import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data?: unknown; error?: { message: string } | null; count?: number | null };

const state = vi.hoisted(() => ({
  access: {} as Record<string, unknown>,
  // Each query the routes await takes the next result, in order.
  queue: [] as unknown[],
  calls: [] as [string, unknown[]][],
}));

vi.mock('@/lib/suspicious-log-access', () => ({
  getSuspiciousLogAccess: vi.fn(async () => state.access),
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      state.calls.push(['from', [table]]);
      const next = () => (state.queue.shift() ?? { data: null, error: null }) as Result;
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'is', 'gt', 'order', 'limit', 'in', 'update', 'upsert', 'delete']) {
        chain[method] = (...args: unknown[]) => {
          state.calls.push([method, args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => void) => resolve(next());
      chain.maybeSingle = async () => next();
      return chain;
    },
  }),
}));

import { GET } from './route';
import { POST as SUBSCRIBE } from './subscription/route';
import { DELETE as CLEAR_REVIEW, POST as REVIEW } from './review/route';

const base = { ok: true, streamId: 's1', logEnabled: true, logStatus: 'active', logStatusAt: null };
const streamer = { ...base, role: 'streamer', userId: '100', userLogin: 'streamer' };
const mod = { ...base, role: 'mod', userId: '200', userLogin: 'themod' };

const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const called = (method: string) => state.calls.filter(([name]) => name === method).map(([, args]) => args);

beforeEach(() => {
  state.access = mod;
  state.queue = [];
  state.calls = [];
});

afterEach(() => vi.clearAllMocks());

describe('GET /api/suspicious-log/network', () => {
  it.each([
    ['unauthenticated', 401],
    ['forbidden', 403],
  ])('refuses %s', async (reason, status) => {
    state.access = { ok: false, reason };
    expect((await GET(req('/api/suspicious-log/network'))).status).toBe(status);
    expect(state.calls).toEqual([]);
  });

  it('loads no flags until the streamer turns receiving on', async () => {
    state.queue = [{ data: { flag_network_subscribed: false } }];
    const body = await (await GET(req('/api/suspicious-log/network'))).json();
    expect(body).toEqual({ logEnabled: true, subscribed: false, canSubscribe: false, chatters: [], truncated: false });
    expect(called('from')).toEqual([['streams']]);
  });

  it('lists other channels’ live flags without ever asking who made them', async () => {
    state.queue = [
      { data: { flag_network_subscribed: true } },
      {
        data: [
          {
            id: 'f1',
            chatter_user_id: '900',
            chatter_login: 'troll',
            chatter_name: 'Troll',
            category: 'hate',
            context: 'slurs',
            created_at: '2026-11-10T00:00:00Z',
            updated_at: null,
            streams: { display_name: 'Other', twitch_login: 'other', approved: true },
            chatter_flag_messages: [],
          },
        ],
      },
      { data: [] }, // reviews
      { data: [{ chatter_user_id: '900' }] }, // in my log
    ];
    const res = await GET(req('/api/suspicious-log/network?filter=all'));
    const body = await res.json();
    expect(body.subscribed).toBe(true);
    expect(body.chatters).toHaveLength(1);
    expect(body.chatters[0]).toMatchObject({ chatter_user_id: '900', inMyLog: true, isNew: true });
    expect(body.chatters[0].flags[0].channelName).toBe('Other');

    const selects = called('select').map(([cols]) => String(cols));
    expect(selects.some((cols) => cols.includes('created_by'))).toBe(false);
    expect(called('neq')).toContainEqual(['stream_id', 's1']);
    expect(called('is')).toContainEqual(['withdrawn_at', null]);
    expect(called('is')).toContainEqual(['removed_at', null]);
    expect(JSON.stringify(body)).not.toContain('created_by');
  });
});

describe('POST /api/suspicious-log/network/subscription', () => {
  const subscribe = (body: unknown) => SUBSCRIBE(req('/api/suspicious-log/network/subscription', 'POST', body));

  it('is the streamer’s call alone', async () => {
    expect((await subscribe({ subscribed: true })).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it('needs the module on to turn receiving on, but not to turn it off', async () => {
    state.access = { ...streamer, logEnabled: false };
    expect((await subscribe({ subscribed: true })).status).toBe(403);
    expect((await subscribe({ subscribed: false })).status).toBe(200);
    expect(called('update')).toEqual([[{ flag_network_subscribed: false }]]);
  });

  it('saves the choice', async () => {
    state.access = streamer;
    expect((await subscribe({ subscribed: true })).status).toBe(200);
    expect(called('update')).toEqual([[{ flag_network_subscribed: true }]]);
    expect(called('eq')).toContainEqual(['id', 's1']);
  });

  it('rejects a malformed request', async () => {
    state.access = streamer;
    expect((await subscribe({ subscribed: 'yes' })).status).toBe(400);
  });
});

describe('/api/suspicious-log/network/review', () => {
  const review = (body: unknown) => REVIEW(req('/api/suspicious-log/network/review', 'POST', body));

  it('rejects an unknown decision', async () => {
    expect((await review({ chatterId: '900', decision: 'nuke' })).status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it('refuses a channel that isn’t receiving flags', async () => {
    state.queue = [{ data: { flag_network_subscribed: false } }];
    expect((await review({ chatterId: '900', decision: 'banned' })).status).toBe(403);
  });

  it('refuses a chatter no other channel has a live flag on', async () => {
    state.queue = [{ data: { flag_network_subscribed: true } }, { count: 0 }];
    expect((await review({ chatterId: '900', decision: 'banned' })).status).toBe(404);
    expect(called('upsert')).toEqual([]);
  });

  it('lets a mod record a decision, as themselves', async () => {
    state.queue = [{ data: { flag_network_subscribed: true } }, { count: 2 }, {}];
    expect((await review({ chatterId: '900', decision: 'banned' })).status).toBe(200);
    expect(called('upsert')[0][0]).toMatchObject({
      stream_id: 's1',
      chatter_user_id: '900',
      decision: 'banned',
      decided_by_id: '200',
      decided_by_login: 'themod',
    });
    expect(called('neq')).toContainEqual(['stream_id', 's1']);
  });

  it('clears a decision', async () => {
    state.queue = [{ data: { flag_network_subscribed: true } }, {}];
    const res = await CLEAR_REVIEW(req('/api/suspicious-log/network/review', 'DELETE', { chatterId: '900' }));
    expect(res.status).toBe(200);
    expect(called('delete')).toHaveLength(1);
    expect(called('eq')).toContainEqual(['chatter_user_id', '900']);
  });
});
