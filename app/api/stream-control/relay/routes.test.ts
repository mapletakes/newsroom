import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data?: unknown; error?: { message: string } | null };

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  access: {} as Record<string, unknown>,
  queue: [] as unknown[],
  calls: [] as [string, unknown[]][],
}));

vi.mock('@/lib/session', () => ({ getApprovedSession: vi.fn(async () => state.session) }));
vi.mock('@/lib/stream-control', async (orig) => ({
  ...(await orig<typeof import('@/lib/stream-control')>()),
  getStreamControlAccess: vi.fn(async () => state.access),
}));
vi.mock('@/lib/realtime', () => ({ broadcastStreamControlChange: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      state.calls.push(['from', [table]]);
      const next = () => (state.queue.shift() ?? { data: null, error: null }) as Result;
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'lt', 'gte', 'insert', 'update', 'upsert']) {
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

import { broadcastStreamControlChange } from '@/lib/realtime';
import { POST as claim } from './claim/route';
import { POST as result } from './result/route';
import { POST as stateRoute } from './state/route';

const streamerAccess = { enabled: true, canSwitchScenes: true, canToggleSources: true, canRunRelay: true };
const modAccess = { enabled: true, canSwitchScenes: true, canToggleSources: true, canRunRelay: false };
const CMD = '9c2d3e1f-1111-4222-8333-444455556666';

const req = (path: string, body: unknown) =>
  new NextRequest(`http://localhost/api/stream-control/relay/${path}`, { method: 'POST', body: JSON.stringify(body) });
const called = (method: string) => state.calls.filter(([name]) => name === method).map(([, args]) => args);

beforeEach(() => {
  vi.clearAllMocks();
  state.session = { streamId: 's1', role: 'streamer', twitchUserId: '100' };
  state.access = streamerAccess;
  state.queue = [];
  state.calls = [];
});

describe('relay guard', () => {
  it('turns away a signed-out caller', async () => {
    state.session = null;
    expect((await claim()).status).toBe(401);
  });

  it('turns everyone away with the module off', async () => {
    state.access = { ...streamerAccess, enabled: false, canRunRelay: false };
    expect((await claim()).status).toBe(403);
  });

  it('never lets a mod act as the relay, whatever their grants', async () => {
    state.access = modAccess;
    expect((await claim()).status).toBe(403);
    expect((await stateRoute(req('state', { connected: true }))).status).toBe(403);
    expect((await result(req('result', { id: CMD, ok: true }))).status).toBe(403);
    expect(called('update')).toHaveLength(0);
  });
});

describe('POST state', () => {
  const snapshot = {
    activeSceneId: 'a',
    scenes: [{ id: 'a', name: 'Live', items: [{ id: 'i1', name: 'Cam', type: 'item', visible: true, parentId: null }] }],
  };

  it('stores a valid snapshot for this stream and tells the panels', async () => {
    const res = await stateRoute(req('state', { connected: true, snapshot }));
    expect(res.status).toBe(200);
    const [row] = called('upsert')[0] as [Record<string, unknown>];
    expect(row).toMatchObject({ stream_id: 's1', snapshot, streamlabs_connected: true });
    expect(broadcastStreamControlChange).toHaveBeenCalledWith('s1');
  });

  it('rejects a malformed snapshot', async () => {
    const res = await stateRoute(req('state', { connected: true, snapshot: { scenes: 'nope' } }));
    expect(res.status).toBe(400);
    expect(called('upsert')).toHaveLength(0);
  });

  it('requires connected', async () => {
    expect((await stateRoute(req('state', { snapshot }))).status).toBe(400);
  });

  it('heartbeats quietly when nothing changed', async () => {
    state.queue = [{ data: { streamlabs_connected: true } }, { error: null }];
    const res = await stateRoute(req('state', { connected: true }));
    expect(res.status).toBe(200);
    expect(called('update')[0][0]).toMatchObject({ streamlabs_connected: true });
    expect(broadcastStreamControlChange).not.toHaveBeenCalled();
  });

  it('tells the panels when Streamlabs drops', async () => {
    state.queue = [{ data: { streamlabs_connected: true } }, { error: null }];
    await stateRoute(req('state', { connected: false }));
    expect(broadcastStreamControlChange).toHaveBeenCalledWith('s1');
  });

  it('creates the row on a first heartbeat', async () => {
    state.queue = [{ data: null }, { error: null }];
    await stateRoute(req('state', { connected: false }));
    expect(called('insert')[0][0]).toMatchObject({ stream_id: 's1', streamlabs_connected: false, snapshot: { scenes: [] } });
  });
});

describe('POST claim', () => {
  it('expires stale commands, claims fresh ones oldest first', async () => {
    state.queue = [
      { data: [{ id: 'old' }] },
      {
        data: [
          { id: 'b', kind: 'switch_scene', args: { sceneId: 'x' }, actor_login: 'm', created_at: '2026-11-26T20:00:02Z' },
          { id: 'a', kind: 'switch_scene', args: { sceneId: 'y' }, actor_login: 'm', created_at: '2026-11-26T20:00:01Z' },
        ],
      },
    ];
    const res = await claim();
    const body = await res.json();
    expect(body.commands.map((c: { id: string }) => c.id)).toEqual(['a', 'b']);
    const [expire, take] = called('update');
    expect(expire[0]).toMatchObject({ status: 'expired' });
    expect(take[0]).toEqual({ status: 'running' });
    // Both updates are confined to this stream's pending rows.
    expect(called('eq')).toEqual(
      expect.arrayContaining([
        ['stream_id', 's1'],
        ['status', 'pending'],
      ]),
    );
    expect(broadcastStreamControlChange).toHaveBeenCalledWith('s1');
  });

  it('stays quiet when nothing expired', async () => {
    state.queue = [{ data: [] }, { data: [] }];
    const body = await (await claim()).json();
    expect(body.commands).toEqual([]);
    expect(broadcastStreamControlChange).not.toHaveBeenCalled();
  });
});

describe('POST result', () => {
  it('finishes a running command of this stream', async () => {
    state.queue = [{ data: [{ id: CMD }] }];
    const res = await result(req('result', { id: CMD, ok: true }));
    expect(res.status).toBe(200);
    expect(called('update')[0][0]).toMatchObject({ status: 'done', error: null });
    expect(called('eq')).toEqual(
      expect.arrayContaining([
        ['id', CMD],
        ['stream_id', 's1'],
        ['status', 'running'],
      ]),
    );
  });

  it('records a failure with a capped message', async () => {
    state.queue = [{ data: [{ id: CMD }] }];
    await result(req('result', { id: CMD, ok: false, error: 'x'.repeat(900) }));
    const [patch] = called('update')[0] as [Record<string, string>];
    expect(patch.status).toBe('failed');
    expect(patch.error).toHaveLength(500);
  });

  it('404s a command that is not running here', async () => {
    state.queue = [{ data: [] }];
    expect((await result(req('result', { id: CMD, ok: true }))).status).toBe(404);
  });

  it('rejects a bad id', async () => {
    expect((await result(req('result', { id: 'nope', ok: true }))).status).toBe(400);
  });
});
