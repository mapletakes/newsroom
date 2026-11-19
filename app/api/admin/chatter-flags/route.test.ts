import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data?: unknown; error?: { message: string; code?: string } | null };

const state = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  queue: [] as unknown[],
  calls: [] as [string, unknown[]][],
  audit: [] as unknown[][],
}));

vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => state.session) }));
vi.mock('@/lib/admin', () => ({ isAdmin: (id?: string) => id === '1' }));
vi.mock('@/lib/audit', () => ({
  logAdminAction: vi.fn(async (...args: unknown[]) => {
    // (sb, actor, action, streamId, payload): keep what was done to what.
    state.audit.push(args.slice(2));
  }),
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      state.calls.push(['from', [table]]);
      const next = () => (state.queue.shift() ?? { data: null, error: null }) as Result;
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'not', 'order', 'limit', 'update']) {
        chain[method] = (...args: unknown[]) => {
          state.calls.push([method, args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => void) => resolve(next());
      return chain;
    },
  }),
}));

import { POST } from './route';

const FLAG = '9c2d3e1f-1111-4222-8333-444455556666';
const admin = { twitchUserId: '1', twitchLogin: 'boss' };
const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/chatter-flags', { method: 'POST', body: JSON.stringify(body) }));
const called = (method: string) => state.calls.filter(([name]) => name === method).map(([, args]) => args);

beforeEach(() => {
  state.session = admin;
  state.queue = [];
  state.calls = [];
  state.audit = [];
});

afterEach(() => vi.clearAllMocks());

describe('POST /api/admin/chatter-flags', () => {
  it('is admins only', async () => {
    state.session = { twitchUserId: '2' };
    expect((await post({ id: FLAG, action: 'remove', reason: 'x' })).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it('needs a reason to remove', async () => {
    expect((await post({ id: FLAG, action: 'remove', reason: '  ' })).status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it('removes a flag with who and why, and audits it', async () => {
    state.queue = [{ data: [{ id: FLAG, stream_id: 's1', chatter_login: 'troll' }] }];
    expect((await post({ id: FLAG, action: 'remove', reason: 'No evidence of harassment' })).status).toBe(200);
    expect(called('update')[0][0]).toMatchObject({ removed_by_login: 'boss', removed_reason: 'No evidence of harassment' });
    expect(state.audit).toEqual([['remove_flag', 's1', { chatter: 'troll', reason: 'No evidence of harassment' }]]);
  });

  it('can’t restore over a newer live flag', async () => {
    state.queue = [{ error: { message: 'duplicate', code: '23505' } }];
    expect((await post({ id: FLAG, action: 'restore' })).status).toBe(409);
    expect(state.audit).toEqual([]);
  });

  it('is a 404 when nothing matched', async () => {
    state.queue = [{ data: [] }];
    expect((await post({ id: FLAG, action: 'restore' })).status).toBe(404);
  });
});
