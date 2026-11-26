// Browser-side client for the Streamlabs Desktop remote-control API, used only
// by the stream-control relay page on the streamer's own PC.
//
// The token this connects with can do anything to the stream, going live and
// deleting scenes included. This class is the line that keeps mods away from
// all of that: it reads scenes, and its only two write methods are
// switchScene and setVisibility. Nothing else here sends a Streamlabs method
// name chosen by anyone but this file — keep it that way. A generic "call any
// method" escape hatch would turn a mod's panel into full control of the
// streamer's broadcast.

import type { ControlItem, ControlSnapshot } from './stream-control-shared';

export const STREAMLABS_URL = 'ws://127.0.0.1:59650/api/websocket';
const CALL_TIMEOUT_MS = 5000;

/** The parts of a Streamlabs scene node this file reads. */
export type RawNode = {
  id: string;
  name?: string;
  sceneNodeType?: string;
  visible?: boolean;
  parentId?: string | null;
  sourceId?: string;
  resourceId?: string;
};
export type RawScene = { id: string; name?: string; nodes?: RawNode[] };

/** Turns Streamlabs' scene models into the snapshot broadside stores. */
export function toSnapshot(scenes: RawScene[], activeSceneId: string | null): ControlSnapshot {
  return {
    activeSceneId,
    scenes: scenes.map((s) => ({
      id: s.id,
      name: s.name ?? '',
      items: (s.nodes ?? []).map(
        (n): ControlItem => ({
          id: n.id,
          name: n.name ?? '',
          type: n.sceneNodeType === 'folder' ? 'folder' : 'item',
          visible: n.visible !== false,
          parentId: n.parentId || null,
        }),
      ),
    })),
  };
}

/** The resource a scene item's methods are called on. Streamlabs includes it
 *  on the node; older versions didn't, and it can be built from the ids. */
export function itemResource(sceneId: string, node: RawNode): string {
  return node.resourceId || `SceneItem${JSON.stringify([sceneId, node.id, node.sourceId ?? ''])}`;
}

// Everything Streamlabs announces that can change what mods see. Any of them
// just triggers a fresh read; the event payloads themselves aren't used.
const SUBSCRIPTIONS: [resource: string, event: string][] = [
  ['ScenesService', 'sceneSwitched'],
  ['ScenesService', 'sceneAdded'],
  ['ScenesService', 'sceneRemoved'],
  ['ScenesService', 'itemAdded'],
  ['ScenesService', 'itemRemoved'],
  ['ScenesService', 'itemUpdated'],
  ['SourcesService', 'sourceUpdated'],
];

/** `unreachable`: nothing answered at 127.0.0.1:59650 (Streamlabs closed,
 *  Remote Control off, or the browser refused). `auth`: Streamlabs answered
 *  and refused the token, so retrying with the same one is pointless. */
export class StreamlabsError extends Error {
  constructor(
    message: string,
    readonly code: 'unreachable' | 'auth' | 'other' = 'other',
  ) {
    super(message);
  }
}

type Options = {
  /** Something in Streamlabs changed. */
  onChange: () => void;
  /** The connection ended, for whatever reason. Not called after close(). */
  onClose: () => void;
  url?: string;
  /** For tests. */
  WebSocketImpl?: typeof WebSocket;
};

export class StreamlabsClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private closedByUs = false;

  constructor(private opts: Options) {}

  /** Opens the socket, signs in with the token, and subscribes to changes.
   *  Rejects with a StreamlabsError saying what went wrong. */
  async connect(token: string): Promise<void> {
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    await new Promise<void>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new Impl(this.opts.url ?? STREAMLABS_URL);
      } catch {
        reject(new StreamlabsError('This browser blocked the connection to Streamlabs.', 'unreachable'));
        return;
      }
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        resolve();
      };
      ws.onerror = () => {
        if (!opened) {
          reject(
            new StreamlabsError(
              'Could not reach Streamlabs. Check it is running with Remote Control turned on, and that this browser allowed access to your local network.',
              'unreachable',
            ),
          );
        }
      };
      ws.onclose = () => {
        this.failPending(new StreamlabsError('Streamlabs connection closed.'));
        if (opened && !this.closedByUs) this.opts.onClose();
      };
      ws.onmessage = (e) => this.handleMessage(e.data);
    });

    try {
      await this.call('TcpServerService', 'auth', [token]);
    } catch {
      this.close();
      throw new StreamlabsError('Streamlabs rejected the token. Copy it again from Settings → Remote Control.', 'auth');
    }
    // Change events are a nicety: the relay still works, just with a staler
    // scene list, if a Streamlabs version doesn't offer one of them.
    await Promise.all(SUBSCRIPTIONS.map(([resource, event]) => this.call(resource, event).catch(() => null)));
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
    this.ws = null;
    this.failPending(new StreamlabsError('Disconnected.'));
  }

  /** Every scene and what's in it, plus which one is live. */
  async readSnapshot(): Promise<ControlSnapshot> {
    const scenes = (await this.call('ScenesService', 'getScenes')) as RawScene[];
    const active = (await this.call('ScenesService', 'activeScene')) as RawScene | null;
    return toSnapshot(scenes ?? [], active?.id ?? null);
  }

  /** Write action 1 of 2. */
  async switchScene(sceneId: string): Promise<void> {
    const ok = await this.call('ScenesService', 'makeSceneActive', [sceneId]);
    if (ok === false) throw new StreamlabsError('That scene no longer exists.');
  }

  /** Write action 2 of 2. Looks the item up fresh by id, so it acts on what is
   *  in Streamlabs now, not on what a panel showed a few seconds ago, and
   *  refuses folders. */
  async setVisibility(sceneId: string, itemId: string, visible: boolean): Promise<void> {
    const scene = (await this.call('ScenesService', 'getScene', [sceneId])) as RawScene | null;
    if (!scene) throw new StreamlabsError('That scene no longer exists.');
    const node = (scene.nodes ?? []).find((n) => n.id === itemId);
    if (!node) throw new StreamlabsError('That source is no longer in the scene.');
    if (node.sceneNodeType === 'folder') throw new StreamlabsError('Folders cannot be shown or hidden.');
    await this.call(itemResource(sceneId, node), 'setVisibility', [visible]);
  }

  private call(resource: string, method: string, args: unknown[] = []): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return Promise.reject(new StreamlabsError('Not connected to Streamlabs.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new StreamlabsError(`Streamlabs did not answer ${method}.`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: { resource, args } }));
    });
  }

  private handleMessage(data: unknown): void {
    let msg: { id?: number | null; result?: { _type?: string }; error?: { message?: string } };
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.result?._type === 'EVENT') {
      this.opts.onChange();
      return;
    }
    const p = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined;
    if (!p) return;
    this.pending.delete(msg.id as number);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new StreamlabsError(msg.error.message || 'Streamlabs returned an error.'));
    else p.resolve(msg.result);
  }

  private failPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
