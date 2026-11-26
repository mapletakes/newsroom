import { describe, expect, it, vi } from 'vitest';
import { StreamlabsClient, itemResource, toSnapshot, type RawScene } from './streamlabs-client';

type Sent = { id: number; method: string; params: { resource: string; args: unknown[] } };

// A stand-in for Streamlabs: answers each call from `handlers`, keyed
// "Resource.method", and records everything sent.
function fakeStreamlabs(handlers: Record<string, (args: unknown[]) => unknown>) {
  const sent: Sent[] = [];
  let socket: FakeSocket | null = null;
  class FakeSocket {
    readyState = 0;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      socket = this;
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }
    send(raw: string) {
      const msg = JSON.parse(raw) as Sent;
      sent.push(msg);
      const key = `${msg.params.resource}.${msg.method}`;
      const handler = handlers[key] ?? (msg.params.resource.startsWith('SceneItem') ? handlers['SceneItem.*'] : undefined);
      queueMicrotask(() => {
        if (!handler) {
          this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { message: `no ${key}` } }) });
          return;
        }
        try {
          const result = handler(msg.params.args);
          this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) });
        } catch (err) {
          this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { message: (err as Error).message } }) });
        }
      });
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  return {
    sent,
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    emit: () => socket?.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: null, result: { _type: 'EVENT', resourceId: 'ScenesService.sceneSwitched' } }) }),
    drop: () => socket?.close(),
  };
}

const live: RawScene = {
  id: 'scene-live',
  name: 'Live Scene',
  nodes: [
    { id: 'cam', name: 'Cam', sceneNodeType: 'item', visible: true, sourceId: 'src-cam', resourceId: 'SceneItem["scene-live","cam","src-cam"]' },
    { id: 'folder', name: 'Overlays', sceneNodeType: 'folder', visible: true },
    { id: 'logo', name: 'Logo', sceneNodeType: 'item', visible: false, parentId: 'folder', sourceId: 'src-logo' },
  ],
};

const baseHandlers = () => ({
  'TcpServerService.auth': () => true,
  'ScenesService.getScenes': () => [live, { id: 'scene-brb', name: 'BRB', nodes: [] }],
  'ScenesService.activeScene': () => live,
  'ScenesService.getScene': ([id]: unknown[]) => (id === live.id ? live : null),
  'ScenesService.makeSceneActive': ([id]: unknown[]) => id === 'scene-brb' || id === live.id,
  'SceneItem.*': () => true,
});

async function connected(handlers = baseHandlers()) {
  const fake = fakeStreamlabs(handlers);
  const onChange = vi.fn();
  const onClose = vi.fn();
  const client = new StreamlabsClient({ onChange, onClose, WebSocketImpl: fake.WebSocketImpl });
  await client.connect('tok');
  return { client, fake, onChange, onClose };
}

describe('toSnapshot', () => {
  it('maps nodes to items and folders', () => {
    expect(toSnapshot([live], 'scene-live')).toEqual({
      activeSceneId: 'scene-live',
      scenes: [
        {
          id: 'scene-live',
          name: 'Live Scene',
          items: [
            { id: 'cam', name: 'Cam', type: 'item', visible: true, parentId: null },
            { id: 'folder', name: 'Overlays', type: 'folder', visible: true, parentId: null },
            { id: 'logo', name: 'Logo', type: 'item', visible: false, parentId: 'folder' },
          ],
        },
      ],
    });
  });
});

describe('itemResource', () => {
  it('prefers the resource Streamlabs gives, else builds one', () => {
    expect(itemResource('s', { id: 'i', resourceId: 'X' })).toBe('X');
    expect(itemResource('s', { id: 'i', sourceId: 'src' })).toBe('SceneItem["s","i","src"]');
  });
});

describe('StreamlabsClient', () => {
  it('signs in with the token first, then subscribes', async () => {
    const { fake } = await connected();
    expect(fake.sent[0]).toMatchObject({ method: 'auth', params: { resource: 'TcpServerService', args: ['tok'] } });
    expect(fake.sent.map((m) => m.method)).toContain('sceneSwitched');
  });

  it('reports a rejected token', async () => {
    const fake = fakeStreamlabs({ ...baseHandlers(), 'TcpServerService.auth': () => { throw new Error('bad token'); } });
    const client = new StreamlabsClient({ onChange: vi.fn(), onClose: vi.fn(), WebSocketImpl: fake.WebSocketImpl });
    await expect(client.connect('nope')).rejects.toThrow(/rejected the token/);
  });

  it('reads a snapshot with the live scene', async () => {
    const { client } = await connected();
    const snap = await client.readSnapshot();
    expect(snap.activeSceneId).toBe('scene-live');
    expect(snap.scenes.map((s) => s.name)).toEqual(['Live Scene', 'BRB']);
  });

  it('switches scenes, and says so when the scene is gone', async () => {
    const { client, fake } = await connected();
    await client.switchScene('scene-brb');
    expect(fake.sent.at(-1)).toMatchObject({ method: 'makeSceneActive', params: { args: ['scene-brb'] } });
    await expect(client.switchScene('deleted')).rejects.toThrow(/no longer exists/);
  });

  it('sets visibility on the item found by id', async () => {
    const { client, fake } = await connected();
    await client.setVisibility('scene-live', 'cam', false);
    expect(fake.sent.at(-1)).toMatchObject({
      method: 'setVisibility',
      params: { resource: 'SceneItem["scene-live","cam","src-cam"]', args: [false] },
    });
  });

  it('refuses folders and missing items without touching Streamlabs', async () => {
    const { client, fake } = await connected();
    const before = fake.sent.length;
    await expect(client.setVisibility('scene-live', 'folder', false)).rejects.toThrow(/Folders/);
    await expect(client.setVisibility('scene-live', 'gone', false)).rejects.toThrow(/no longer in the scene/);
    await expect(client.setVisibility('deleted', 'cam', false)).rejects.toThrow(/scene no longer exists/);
    // Only the getScene lookups went out; no setVisibility.
    expect(fake.sent.slice(before).map((m) => m.method)).toEqual(['getScene', 'getScene', 'getScene']);
  });

  it('only ever sends the methods it is built around', async () => {
    const { client, fake } = await connected();
    await client.readSnapshot();
    await client.switchScene('scene-brb');
    await client.setVisibility('scene-live', 'cam', true);
    const methods = new Set(fake.sent.map((m) => m.method));
    const allowed = new Set([
      'auth', 'getScenes', 'activeScene', 'getScene', 'makeSceneActive', 'setVisibility',
      'sceneSwitched', 'sceneAdded', 'sceneRemoved', 'itemAdded', 'itemRemoved', 'itemUpdated', 'sourceUpdated',
    ]);
    for (const m of methods) expect(allowed).toContain(m);
  });

  it('passes change events on, and reports an unexpected drop', async () => {
    const { fake, onChange, onClose } = await connected();
    fake.emit();
    expect(onChange).toHaveBeenCalledTimes(1);
    fake.drop();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not report its own close as a drop', async () => {
    const { client, onClose } = await connected();
    client.close();
    expect(onClose).not.toHaveBeenCalled();
  });
});
