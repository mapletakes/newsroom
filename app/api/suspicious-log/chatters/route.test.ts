import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  access: {} as Record<string, unknown>,
  calls: [] as [string, unknown[]][],
  result: { data: [] as unknown[], error: null as { message: string } | null },
}));

vi.mock('@/lib/suspicious-log-access', () => ({
  getSuspiciousLogAccess: vi.fn(async () => state.access),
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      state.calls.push(['from', [table]]);
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'ilike', 'order', 'limit']) {
        chain[method] = (...args: unknown[]) => {
          state.calls.push([method, args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => void) => resolve(state.result);
      return chain;
    },
  }),
}));

import { GET } from './route';

const access = { ok: true, role: 'mod', streamId: 's1', logEnabled: true, logStatus: 'active', logStatusAt: null };
const get = (query = '') => GET(new NextRequest(`http://localhost/api/suspicious-log/chatters${query}`));
const called = (method: string) => state.calls.filter(([name]) => name === method).map(([, args]) => args);

const row = (id: string, login: string, sentAt: string, status = 'restricted') => ({
  chatter_user_id: id,
  chatter_login: login,
  chatter_name: login.toUpperCase(),
  low_trust_status: status,
  sent_at: sentAt,
});

beforeEach(() => {
  state.access = access;
  state.calls = [];
  state.result = { data: [], error: null };
});

afterEach(() => vi.clearAllMocks());

describe('GET /api/suspicious-log/chatters', () => {
  it.each([
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['reconnect', 403],
    ['twitch', 503],
  ])('refuses %s without reading the log', async (reason, status) => {
    state.access = { ok: false, reason };
    expect((await get()).status).toBe(status);
    expect(state.calls).toEqual([]);
  });

  it('lists each chatter once, by their latest message', async () => {
    state.result = {
      data: [
        row('200', 'viewer', '2026-11-18T19:00:00Z', 'active_monitoring'),
        row('300', 'other', '2026-11-18T18:00:00Z'),
        row('200', 'viewer', '2026-11-17T19:00:00Z', 'restricted'),
      ],
      error: null,
    };

    const res = await get();

    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).chatters).toEqual([
      { id: '200', login: 'viewer', name: 'VIEWER', status: 'active_monitoring', last_seen: '2026-11-18T19:00:00Z' },
      { id: '300', login: 'other', name: 'OTHER', status: 'restricted', last_seen: '2026-11-18T18:00:00Z' },
    ]);
  });

  it('only reads this channel and takes the newest messages first', async () => {
    await get();
    expect(called('eq')).toContainEqual(['stream_id', 's1']);
    expect(called('order')).toContainEqual(['sent_at', { ascending: false }]);
  });

  it('matches what was typed anywhere in the login, as literal text', async () => {
    await get('?q=%40Some_One');
    expect(called('ilike')).toContainEqual(['chatter_login', '%some\\_one%']);
  });

  it('applies no name filter to an empty search', async () => {
    await get();
    expect(called('ilike')).toEqual([]);
  });

  it('caps how many chatters it returns', async () => {
    state.result = {
      data: Array.from({ length: 60 }, (_, i) => row(String(i), `user${i}`, '2026-11-18T19:00:00Z')),
      error: null,
    };
    expect((await (await get()).json()).chatters).toHaveLength(25);
  });

  it('reports a failed lookup', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.result = { data: [], error: { message: 'down' } };
    expect((await get()).status).toBe(500);
  });
});
