import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  access: {} as Record<string, unknown>,
  calls: [] as [string, unknown[]][],
  result: { data: [] as unknown[], error: null as { code?: string; message: string } | null, count: 0 as number | null },
}));

vi.mock('@/lib/suspicious-log-access', () => ({
  getSuspiciousLogAccess: vi.fn(async () => state.access),
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      state.calls.push(['from', [table]]);
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'ilike', 'contains', 'gte', 'lt', 'order', 'range', 'limit', 'delete', 'in']) {
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

import { DELETE, GET } from './route';

const ID = '4b4dbeb8-77ce-4eec-96ef-fba4bda9693c';
const streamerAccess = { ok: true, role: 'streamer', streamId: 's1', logEnabled: true, logStatus: 'active', logStatusAt: null };

const get = (query = '') => GET(new NextRequest(`http://localhost/api/suspicious-log${query}`));
const del = (body: unknown) =>
  DELETE(new NextRequest('http://localhost/api/suspicious-log', { method: 'DELETE', body: JSON.stringify(body) }));
const called = (method: string) => state.calls.filter(([name]) => name === method).map(([, args]) => args);

beforeEach(() => {
  state.access = streamerAccess;
  state.calls = [];
  state.result = { data: [], error: null, count: 0 };
});

afterEach(() => vi.clearAllMocks());

describe('GET /api/suspicious-log', () => {
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

  it('only reads this channel\'s messages and is never cached', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(called('eq')).toContainEqual(['stream_id', 's1']);
  });

  it('applies filters, matching search wildcards literally', async () => {
    await get('?q=100%25&user=@Viewer&status=restricted&type=ban_evader&page=2');
    expect(called('ilike')).toContainEqual(['message_text', '%100\\%%']);
    expect(called('ilike')).toContainEqual(['chatter_login', 'viewer%']);
    expect(called('eq')).toContainEqual(['low_trust_status', 'restricted']);
    expect(called('contains')).toContainEqual(['detection_types', ['ban_evader']]);
    expect(called('range')).toContainEqual([50, 99]);
  });

  it('loads status history only for a single user', async () => {
    await get();
    expect(called('from')).toEqual([['suspicious_messages']]);

    state.calls = [];
    await get('?chatterId=200');
    expect(called('from')).toContainEqual(['suspicious_status_changes']);
  });

  it('tells mods they cannot delete', async () => {
    state.access = { ...streamerAccess, role: 'mod' };
    expect((await (await get()).json()).canDelete).toBe(false);
  });

  it('treats a page past the end as empty', async () => {
    state.result = { data: [], error: { code: 'PGRST103', message: 'range' }, count: null };
    const res = await get('?page=9');
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
  });
});

describe('DELETE /api/suspicious-log', () => {
  it('refuses mods', async () => {
    state.access = { ...streamerAccess, role: 'mod' };
    expect((await del({ ids: [ID] })).status).toBe(403);
    expect(called('delete')).toEqual([]);
  });

  it.each([[{}], [{ ids: [] }], [{ ids: ['not-a-uuid'] }], [{ ids: Array(101).fill(ID) }]])(
    'rejects invalid ids %#',
    async (body) => {
      expect((await del(body)).status).toBe(400);
      expect(called('delete')).toEqual([]);
    },
  );

  it('deletes only within the streamer\'s own channel', async () => {
    state.result = { data: [], error: null, count: 1 };
    const res = await del({ ids: [ID] });
    expect(await res.json()).toEqual({ ok: true, deleted: 1 });
    expect(called('eq')).toContainEqual(['stream_id', 's1']);
    expect(called('in')).toContainEqual(['id', [ID]]);
  });
});
