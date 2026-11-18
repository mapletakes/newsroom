import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data?: unknown; error?: { message: string } | null; count?: number | null };

const state = vi.hoisted(() => ({
  access: {} as Record<string, unknown>,
  // Each query the route awaits takes the next result, in order.
  queue: [] as unknown[],
  calls: [] as [string, unknown[]][],
}));

vi.mock('@/lib/suspicious-log-access', () => ({
  getSuspiciousLogAccess: vi.fn(async () => state.access),
}));
vi.mock('@/lib/suspicious-log-share', async (orig) => ({
  ...(await orig<typeof import('@/lib/suspicious-log-share')>()),
  newShareToken: () => 'sl_' + 'a'.repeat(48),
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      state.calls.push(['from', [table]]);
      const next = () => (state.queue.shift() ?? { data: null, error: null }) as Result;
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'gt', 'order', 'limit', 'in', 'insert', 'update']) {
        chain[method] = (...args: unknown[]) => {
          state.calls.push([method, args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => void) => resolve(next());
      chain.single = async () => next();
      return chain;
    },
  }),
}));

import { DELETE, GET, POST } from './route';

const ID = '4b4dbeb8-77ce-4eec-96ef-fba4bda9693c';
const SHARE_ID = '9c2d3e1f-1111-4222-8333-444455556666';
const streamer = { ok: true, role: 'streamer', userId: '100', userLogin: 'streamer', streamId: 's1' };
const mod = { ok: true, role: 'mod', userId: '200', userLogin: 'themod', streamId: 's1' };

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/suspicious-log/share', { method: 'POST', body: JSON.stringify(body) }));
const get = () => GET(new NextRequest('http://localhost/api/suspicious-log/share'));
const del = (body: unknown) =>
  DELETE(new NextRequest('http://localhost/api/suspicious-log/share', { method: 'DELETE', body: JSON.stringify(body) }));
const called = (method: string) => state.calls.filter(([name]) => name === method).map(([, args]) => args);

beforeEach(() => {
  state.access = mod;
  state.queue = [];
  state.calls = [];
});

afterEach(() => vi.clearAllMocks());

describe('POST /api/suspicious-log/share', () => {
  it.each([
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['reconnect', 403],
    ['twitch', 503],
  ])('refuses %s without touching the database', async (reason, status) => {
    state.access = { ok: false, reason };
    expect((await post({ kind: 'chatter', chatterId: '200' })).status).toBe(status);
    expect(state.calls).toEqual([]);
  });

  it.each([[null], [{}], [{ kind: 'messages', messageIds: [] }], [{ kind: 'messages', messageIds: ['nope'] }], [{ kind: 'chatter', chatterId: 'x' }]])(
    'rejects an invalid request %#',
    async (body) => {
      expect((await post(body)).status).toBe(400);
      expect(state.calls).toEqual([]);
    },
  );

  it('lets a mod share selected messages and records who made the link', async () => {
    state.queue = [
      { count: 0 },
      { data: [{ id: ID, chatter_user_id: '300', chatter_name: 'Viewer' }] },
      { data: { id: SHARE_ID } },
    ];

    const res = await post({ kind: 'messages', messageIds: [ID] });

    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { share } = await res.json();
    expect(share).toMatchObject({ id: SHARE_ID, kind: 'messages', label: 'Viewer' });
    expect(share.url).toBe('http://localhost/sl/sl_' + 'a'.repeat(48));
    expect(new Date(share.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect(called('insert')[0][0]).toMatchObject({
      stream_id: 's1',
      kind: 'messages',
      message_ids: [ID],
      created_by_id: '200',
      created_by_login: 'themod',
    });
  });

  it('only links messages that belong to this channel', async () => {
    state.queue = [{ count: 0 }, { data: [] }];
    expect((await post({ kind: 'messages', messageIds: [ID] })).status).toBe(404);
    expect(called('eq')).toContainEqual(['stream_id', 's1']);
    expect(called('insert')).toEqual([]);
  });

  it('gives a mixed selection a generic heading', async () => {
    const other = '5d6e7f80-1111-4222-8333-444455556666';
    state.queue = [
      { count: 0 },
      {
        data: [
          { id: ID, chatter_user_id: '300', chatter_name: 'One' },
          { id: other, chatter_user_id: '400', chatter_name: 'Two' },
        ],
      },
      { data: { id: SHARE_ID } },
    ];
    expect((await (await post({ kind: 'messages', messageIds: [ID, other] })).json()).share.label).toBe(
      'Selected messages',
    );
  });

  it('shares one chatter by id, named from their latest message', async () => {
    state.queue = [{ count: 0 }, { data: [{ chatter_name: 'Viewer' }] }, { data: { id: SHARE_ID } }];

    const res = await post({ kind: 'chatter', chatterId: '300' });

    expect(res.status).toBe(201);
    expect(called('insert')[0][0]).toMatchObject({ kind: 'chatter', chatter_user_id: '300', label: 'Viewer' });
  });

  it('refuses a chatter with nothing in this channel', async () => {
    state.queue = [{ count: 0 }, { data: [] }];
    expect((await post({ kind: 'chatter', chatterId: '300' })).status).toBe(404);
  });

  it('stops at the cap on live links', async () => {
    state.queue = [{ count: 200 }];
    expect((await post({ kind: 'chatter', chatterId: '300' })).status).toBe(409);
    expect(called('insert')).toEqual([]);
  });

  it('reports a failed write', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.queue = [{ count: 0 }, { data: [{ chatter_name: 'Viewer' }] }, { data: null, error: { message: 'down' } }];
    expect((await post({ kind: 'chatter', chatterId: '300' })).status).toBe(500);
  });
});

describe('GET /api/suspicious-log/share', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: SHARE_ID,
    token: 'sl_' + 'b'.repeat(48),
    kind: 'chatter',
    label: 'Viewer',
    created_by_id: '200',
    created_by_login: 'themod',
    created_at: '2026-11-18T19:00:00Z',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    revoked_at: null,
    ...over,
  });

  it('shows a mod only their own links', async () => {
    state.queue = [{ data: [] }];
    await get();
    expect(called('eq')).toContainEqual(['created_by_id', '200']);
  });

  it('shows the streamer every link', async () => {
    state.access = streamer;
    state.queue = [{ data: [] }];
    await get();
    expect(called('eq').some(([column]) => column === 'created_by_id')).toBe(false);
  });

  it('gives a working link its URL and withholds it once the link is dead', async () => {
    state.queue = [
      {
        data: [
          row(),
          row({ id: 'r', revoked_at: '2026-11-18T20:00:00Z' }),
          row({ id: 'e', expires_at: '2026-01-01T00:00:00Z' }),
        ],
      },
    ];

    const { shares } = await (await get()).json();

    expect(shares.map((s: { status: string }) => s.status)).toEqual(['active', 'revoked', 'expired']);
    expect(shares[0].url).toBe('http://localhost/sl/sl_' + 'b'.repeat(48));
    expect(shares[1].url).toBeNull();
    expect(shares[2].url).toBeNull();
    expect(shares[0].mine).toBe(true);
    expect(JSON.stringify(shares)).not.toContain('created_by_id');
  });
});

describe('DELETE /api/suspicious-log/share', () => {
  it('rejects an invalid id', async () => {
    expect((await del({ id: 'nope' })).status).toBe(400);
    expect(called('update')).toEqual([]);
  });

  it('lets a mod revoke only their own link', async () => {
    state.queue = [{ data: [{ id: SHARE_ID }] }];
    expect((await del({ id: SHARE_ID })).status).toBe(200);
    expect(called('eq')).toContainEqual(['created_by_id', '200']);
    expect(called('eq')).toContainEqual(['stream_id', 's1']);
  });

  it('lets the streamer revoke anyone\'s link', async () => {
    state.access = streamer;
    state.queue = [{ data: [{ id: SHARE_ID }] }];
    expect((await del({ id: SHARE_ID })).status).toBe(200);
    expect(called('eq').some(([column]) => column === 'created_by_id')).toBe(false);
  });

  it('reports a link that is not there, or not the mod\'s to revoke', async () => {
    state.queue = [{ data: [] }];
    expect((await del({ id: SHARE_ID })).status).toBe(404);
  });
});
