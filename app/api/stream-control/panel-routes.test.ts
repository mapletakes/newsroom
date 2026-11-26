import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data?: unknown; error?: { message: string } | null };

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  access: {} as Record<string, unknown>,
  limited: false,
  // Results by table, taken in order.
  results: {} as Record<string, unknown[]>,
  calls: [] as [string, string, unknown[]][],
}));

vi.mock('@/lib/session', () => ({
  getApprovedSession: vi.fn(async () => state.session),
  sessionLogin: (s: { twitchLogin?: string; displayName: string }) => s.twitchLogin || s.displayName,
}));
vi.mock('@/lib/stream-control', async (orig) => ({
  ...(await orig<typeof import('@/lib/stream-control')>()),
  getStreamControlAccess: vi.fn(async () => state.access),
}));
vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn(async () => (state.limited ? { ok: false, retryAfterSeconds: 30 } : { ok: true })),
  hashKey: (s: string) => s,
}));
vi.mock('@/lib/realtime', () => ({
  broadcastStreamControlChange: vi.fn(async () => {}),
  broadcastStreamControlCommand: vi.fn(async () => {}),
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const next = () => ((state.results[table] ?? []).shift() ?? { data: null, error: null }) as Result;
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order', 'limit', 'insert']) {
        chain[method] = (...args: unknown[]) => {
          state.calls.push([table, method, args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => void) => resolve(next());
      chain.maybeSingle = async () => next();
      chain.single = async () => next();
      return chain;
    },
  }),
}));

import { broadcastStreamControlCommand } from '@/lib/realtime';
import { GET as getLog, POST as postCommand } from './commands/route';
import { GET as getState } from './state/route';

const full = { enabled: true, canSwitchScenes: true, canToggleSources: true, canRunRelay: true };
const switcher = { enabled: true, canSwitchScenes: true, canToggleSources: false, canRunRelay: false };
const toggler = { enabled: true, canSwitchScenes: false, canToggleSources: true, canRunRelay: false };
const noGrants = { enabled: true, canSwitchScenes: false, canToggleSources: false, canRunRelay: false };

const snapshot = {
  activeSceneId: 'live',
  scenes: [
    {
      id: 'live',
      name: 'Live Scene',
      items: [
        { id: 'cam', name: 'Cam', type: 'item', visible: true, parentId: null },
        { id: 'grp', name: 'Overlays', type: 'folder', visible: true, parentId: null },
      ],
    },
    { id: 'brb', name: 'BRB', items: [{ id: 'logo', name: 'Logo', type: 'item', visible: true, parentId: null }] },
  ],
};
const seenNow = () => new Date().toISOString();
const onlineState = (extra: Record<string, unknown> = {}) => ({
  data: { snapshot, streamlabs_connected: true, relay_seen_at: seenNow(), updated_at: seenNow(), ...extra },
});
const commandRow = {
  id: 'c1',
  kind: 'switch_scene',
  args: { sceneId: 'brb' },
  actor_login: 'themod',
  status: 'pending',
  error: null,
  created_at: '2026-11-26T20:00:00Z',
};

const post = (body: unknown) =>
  postCommand(new NextRequest('http://localhost/api/stream-control/commands', { method: 'POST', body: JSON.stringify(body) }));
const inserted = () => state.calls.filter(([, m]) => m === 'insert').map(([, , args]) => args[0]);

beforeEach(() => {
  vi.clearAllMocks();
  state.session = { streamId: 's1', accountId: '200', role: 'mod', twitchUserId: '200', twitchLogin: 'themod', displayName: 'TheMod' };
  state.access = full;
  state.limited = false;
  state.results = {};
  state.calls = [];
});

describe('GET state', () => {
  it('returns the snapshot, relay status, access and recent commands', async () => {
    state.access = switcher;
    state.results = { stream_control_state: [onlineState()], stream_control_commands: [{ data: [commandRow] }] };
    const body = await (await getState()).json();
    expect(body).toMatchObject({
      relayOnline: true,
      streamlabsConnected: true,
      access: { canSwitchScenes: true, canToggleSources: false },
      recent: [{ id: 'c1', actorLogin: 'themod', status: 'pending' }],
    });
    expect(body.snapshot.scenes).toHaveLength(2);
  });

  it('reports a stale relay as offline, and not connected', async () => {
    state.results = {
      stream_control_state: [onlineState({ relay_seen_at: '2026-01-01T00:00:00Z' })],
      stream_control_commands: [{ data: [] }],
    };
    const body = await (await getState()).json();
    expect(body).toMatchObject({ relayOnline: false, streamlabsConnected: false });
  });

  it('copes with no relay ever having run', async () => {
    state.results = { stream_control_commands: [{ data: [] }] };
    const body = await (await getState()).json();
    expect(body).toMatchObject({ relayOnline: false, snapshot: { activeSceneId: null, scenes: [] } });
  });

  it('turns away a mod with no grants', async () => {
    state.access = noGrants;
    expect((await getState()).status).toBe(403);
  });

  it('turns everyone away with the module off', async () => {
    state.access = { ...full, enabled: false };
    expect((await getState()).status).toBe(403);
  });
});

describe('POST commands', () => {
  it('queues a scene switch and wakes the relay', async () => {
    state.access = switcher;
    state.results = { stream_control_state: [onlineState()], stream_control_commands: [{ data: commandRow }] };
    const res = await post({ kind: 'switch_scene', args: { sceneId: 'brb' } });
    expect(res.status).toBe(201);
    expect(inserted()[0]).toEqual({
      stream_id: 's1',
      kind: 'switch_scene',
      args: { sceneId: 'brb' },
      actor_account_id: '200',
      actor_login: 'themod',
      target_name: 'BRB',
    });
    expect(broadcastStreamControlCommand).toHaveBeenCalledWith('s1');
  });

  it('queues a show/hide in the live scene, recording the source name', async () => {
    state.access = toggler;
    state.results = { stream_control_state: [onlineState()], stream_control_commands: [{ data: commandRow }] };
    const res = await post({ kind: 'set_visibility', args: { sceneId: 'live', itemId: 'cam', visible: false } });
    expect(res.status).toBe(201);
    expect(inserted()[0]).toMatchObject({ target_name: 'Cam' });
  });

  it('holds each mod to their own grant', async () => {
    state.access = switcher;
    expect((await post({ kind: 'set_visibility', args: { sceneId: 'live', itemId: 'cam', visible: false } })).status).toBe(403);
    state.access = toggler;
    expect((await post({ kind: 'switch_scene', args: { sceneId: 'brb' } })).status).toBe(403);
    expect(inserted()).toHaveLength(0);
  });

  it('rejects anything but the two commands', async () => {
    expect((await post({ kind: 'remove_scene', args: { sceneId: 'live' } })).status).toBe(400);
  });

  it('rate-limits', async () => {
    state.limited = true;
    const res = await post({ kind: 'switch_scene', args: { sceneId: 'brb' } });
    expect(res.status).toBe(429);
    expect((await res.json()).retryAfterSeconds).toBe(30);
  });

  it('refuses while the relay is offline or Streamlabs is disconnected', async () => {
    state.results = { stream_control_state: [onlineState({ relay_seen_at: '2026-01-01T00:00:00Z' })] };
    let res = await post({ kind: 'switch_scene', args: { sceneId: 'brb' } });
    expect([res.status, (await res.json()).error]).toEqual([409, 'relay-offline']);
    state.results = { stream_control_state: [onlineState({ streamlabs_connected: false })] };
    res = await post({ kind: 'switch_scene', args: { sceneId: 'brb' } });
    expect([res.status, (await res.json()).error]).toEqual([409, 'streamlabs-disconnected']);
    expect(inserted()).toHaveLength(0);
  });

  it('refuses targets the relay never reported', async () => {
    state.results = { stream_control_state: [onlineState()] };
    expect((await post({ kind: 'switch_scene', args: { sceneId: 'gone' } })).status).toBe(404);
    state.results = { stream_control_state: [onlineState()] };
    expect((await post({ kind: 'set_visibility', args: { sceneId: 'live', itemId: 'gone', visible: true } })).status).toBe(404);
  });

  it('refuses folders', async () => {
    state.results = { stream_control_state: [onlineState()] };
    expect((await post({ kind: 'set_visibility', args: { sceneId: 'live', itemId: 'grp', visible: false } })).status).toBe(404);
  });

  it('only toggles sources in the live scene', async () => {
    state.results = { stream_control_state: [onlineState()] };
    const res = await post({ kind: 'set_visibility', args: { sceneId: 'brb', itemId: 'logo', visible: false } });
    expect([res.status, (await res.json()).error]).toEqual([409, 'not-live-scene']);
  });
});

describe('GET commands (streamer log)', () => {
  it('is for the streamer only', async () => {
    expect((await getLog()).status).toBe(403);
  });

  it('lists the channel’s commands', async () => {
    state.session = { ...state.session, role: 'streamer' };
    state.results = { stream_control_commands: [{ data: [commandRow] }] };
    const body = await (await getLog()).json();
    expect(body.commands).toEqual([
      {
        id: 'c1',
        kind: 'switch_scene',
        args: { sceneId: 'brb' },
        actorLogin: 'themod',
        targetName: null,
        status: 'pending',
        error: null,
        createdAt: '2026-11-26T20:00:00Z',
      },
    ]);
  });
});
