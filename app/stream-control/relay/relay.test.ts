import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamlabsError } from '@/lib/streamlabs-client';
import type { ControlSnapshot } from '@/lib/stream-control-shared';
import { RETRY_MS, createRelay, type RelayCallbacks } from './relay';

const snapshot: ControlSnapshot = {
  activeSceneId: 'live',
  scenes: [
    { id: 'live', name: 'Live Scene', items: [{ id: 'cam', name: 'Cam', type: 'item', visible: true, parentId: null }] },
    { id: 'brb', name: 'BRB', items: [] },
  ],
};

type Posted = { path: string; body: unknown };

function setup(opts: { connectError?: Error; commands?: unknown[][] } = {}) {
  const posted: Posted[] = [];
  const claimBatches = [...(opts.commands ?? [])];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('/api/stream-control/relay/', '');
    posted.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = path === 'claim' ? { commands: claimBatches.shift() ?? [] } : { ok: true };
    return new Response(JSON.stringify(json), { status: 200 });
  });
  let hooks: { onChange: () => void; onClose: () => void } | null = null;
  const client = {
    connect: vi.fn(async () => {
      if (opts.connectError) throw opts.connectError;
    }),
    close: vi.fn(),
    readSnapshot: vi.fn(async () => snapshot),
    switchScene: vi.fn(async () => {}),
    setVisibility: vi.fn(async () => {}),
  };
  const cb: RelayCallbacks = { onPhase: vi.fn(), onSnapshot: vi.fn(), onSync: vi.fn(), onLog: vi.fn() };
  const relay = createRelay(cb, {
    fetch: fetchImpl as unknown as typeof fetch,
    createClient: (h) => {
      hooks = h;
      return client;
    },
    now: () => 0,
  });
  const paths = () => posted.map((p) => p.path);
  return { relay, client, cb, posted, paths, drop: () => hooks?.onClose(), change: () => hooks?.onChange() };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('relay', () => {
  it('connects, reports the scenes, then claims', async () => {
    const t = setup();
    t.relay.start('tok');
    await flush();
    expect(t.client.connect).toHaveBeenCalledWith('tok');
    expect(t.cb.onPhase).toHaveBeenLastCalledWith('connected', null);
    expect(t.posted[0]).toEqual({ path: 'state', body: { connected: true, snapshot } });
    expect(t.paths()).toEqual(['state', 'claim']);
    expect(t.relay.connected).toBe(true);
  });

  it('runs claimed commands and reports each result', async () => {
    const t = setup({
      commands: [
        [
          { id: 'c1', kind: 'switch_scene', args: { sceneId: 'brb' }, actor_login: 'modA' },
          { id: 'c2', kind: 'set_visibility', args: { sceneId: 'live', itemId: 'cam', visible: false }, actor_login: 'modB' },
        ],
      ],
    });
    t.relay.start('tok');
    await flush();
    expect(t.client.switchScene).toHaveBeenCalledWith('brb');
    expect(t.client.setVisibility).toHaveBeenCalledWith('live', 'cam', false);
    const results = t.posted.filter((p) => p.path === 'result').map((p) => p.body);
    expect(results).toEqual([
      { id: 'c1', ok: true },
      { id: 'c2', ok: true },
    ]);
    expect(t.cb.onLog).toHaveBeenCalledWith(expect.objectContaining({ text: 'modA switched to BRB' }));
    expect(t.cb.onLog).toHaveBeenCalledWith(expect.objectContaining({ text: 'modB hid Cam' }));
  });

  it('refuses anything that is not one of the two verbs', async () => {
    const t = setup({ commands: [[{ id: 'c1', kind: 'remove_scene', args: { sceneId: 'live' }, actor_login: 'modA' }]] });
    t.relay.start('tok');
    await flush();
    expect(t.posted.find((p) => p.path === 'result')?.body).toEqual({ id: 'c1', ok: false, error: 'Unsupported command.' });
    expect(t.client.switchScene).not.toHaveBeenCalled();
    expect(t.client.setVisibility).not.toHaveBeenCalled();
  });

  it('reports a Streamlabs failure as a failed command', async () => {
    const t = setup({ commands: [[{ id: 'c1', kind: 'switch_scene', args: { sceneId: 'gone' }, actor_login: 'modA' }]] });
    t.client.switchScene.mockRejectedValueOnce(new StreamlabsError('That scene no longer exists.'));
    t.relay.start('tok');
    await flush();
    expect(t.posted.find((p) => p.path === 'result')?.body).toEqual({ id: 'c1', ok: false, error: 'That scene no longer exists.' });
  });

  it('folds pings that arrive mid-run into one more pass', async () => {
    const t = setup();
    t.relay.start('tok');
    await flush();
    const before = t.paths().filter((p) => p === 'claim').length;
    void t.relay.claim();
    void t.relay.claim();
    void t.relay.claim();
    await flush();
    expect(t.paths().filter((p) => p === 'claim').length - before).toBe(2);
  });

  it('re-reports scenes when Streamlabs announces a change', async () => {
    const t = setup();
    t.relay.start('tok');
    await flush();
    t.change();
    t.change();
    await vi.advanceTimersByTimeAsync(300);
    expect(t.client.readSnapshot).toHaveBeenCalledTimes(2);
  });

  it('stops retrying on a rejected token', async () => {
    const t = setup({ connectError: new StreamlabsError('Streamlabs rejected the token.', 'auth') });
    t.relay.start('bad');
    await flush();
    expect(t.cb.onPhase).toHaveBeenLastCalledWith('error', 'Streamlabs rejected the token.');
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
    expect(t.client.connect).toHaveBeenCalledTimes(1);
    expect(t.posted).toEqual([{ path: 'state', body: { connected: false } }]);
  });

  it('keeps retrying while Streamlabs is unreachable', async () => {
    const t = setup({ connectError: new StreamlabsError('Could not reach Streamlabs.', 'unreachable') });
    t.relay.start('tok');
    await flush();
    await vi.advanceTimersByTimeAsync(RETRY_MS * 2 + 10);
    expect(t.client.connect).toHaveBeenCalledTimes(3);
  });

  it('reports a drop, then reconnects', async () => {
    const t = setup();
    t.relay.start('tok');
    await flush();
    t.drop();
    await flush();
    expect(t.relay.connected).toBe(false);
    expect(t.posted.at(-1)).toEqual({ path: 'state', body: { connected: false } });
    await vi.advanceTimersByTimeAsync(RETRY_MS + 10);
    expect(t.client.connect).toHaveBeenCalledTimes(2);
    expect(t.relay.connected).toBe(true);
  });

  it('stop disconnects, reports, and does not retry', async () => {
    const t = setup();
    t.relay.start('tok');
    await flush();
    t.relay.stop();
    await flush();
    expect(t.client.close).toHaveBeenCalled();
    expect(t.posted.at(-1)).toEqual({ path: 'state', body: { connected: false } });
    await vi.advanceTimersByTimeAsync(RETRY_MS * 2);
    expect(t.client.connect).toHaveBeenCalledTimes(1);
  });

  it('heartbeats with the current connection state', async () => {
    const t = setup();
    await t.relay.heartbeat();
    expect(t.posted.at(-1)).toEqual({ path: 'state', body: { connected: false } });
  });
});
