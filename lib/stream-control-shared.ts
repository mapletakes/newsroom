// Stream control types, limits and validators that both the server and the
// relay page in the browser use. No server imports here: the relay bundle
// pulls this file in. Server-only access checks live in ./stream-control.ts.

// ---------------------------------------------------------------------------
// Snapshot: what the relay last saw in Streamlabs.

export type ControlItem = {
  /** Streamlabs scene node id (sceneItemId for items, the folder id for
   *  folders). Commands target this, never the name: one scene can hold two
   *  items with the same name. */
  id: string;
  name: string;
  /** 'folder' groups items in the Streamlabs UI; only 'item' can be toggled. */
  type: 'item' | 'folder';
  visible: boolean;
  /** The folder this sits in, if any. */
  parentId: string | null;
};

export type ControlScene = { id: string; name: string; items: ControlItem[] };

export type ControlSnapshot = { activeSceneId: string | null; scenes: ControlScene[] };

// Caps on what the relay may store. Generous for any real scene collection
// (the largest seen so far has 16 scenes); they exist so a broken or hostile
// client can't park megabytes of JSON on the stream row.
export const MAX_SCENES = 200;
export const MAX_ITEMS_PER_SCENE = 500;
export const MAX_NAME_LENGTH = 200;
export const MAX_ID_LENGTH = 200;

const isId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;

const cleanName = (v: unknown): string =>
  typeof v === 'string' ? v.slice(0, MAX_NAME_LENGTH) : '';

/** Validates a snapshot from the relay, returning a clean copy (unknown fields
 *  dropped) or null if anything is malformed or over the caps. */
export function parseSnapshot(raw: unknown): ControlSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.scenes) || r.scenes.length > MAX_SCENES) return null;
  const activeSceneId = r.activeSceneId === null || r.activeSceneId === undefined ? null : r.activeSceneId;
  if (activeSceneId !== null && !isId(activeSceneId)) return null;

  const scenes: ControlScene[] = [];
  for (const s of r.scenes) {
    if (!s || typeof s !== 'object') return null;
    const scene = s as Record<string, unknown>;
    if (!isId(scene.id) || !Array.isArray(scene.items) || scene.items.length > MAX_ITEMS_PER_SCENE) return null;
    const items: ControlItem[] = [];
    for (const i of scene.items) {
      if (!i || typeof i !== 'object') return null;
      const item = i as Record<string, unknown>;
      if (!isId(item.id)) return null;
      if (item.type !== 'item' && item.type !== 'folder') return null;
      if (typeof item.visible !== 'boolean') return null;
      const parentId = item.parentId === null || item.parentId === undefined ? null : item.parentId;
      if (parentId !== null && !isId(parentId)) return null;
      items.push({ id: item.id, name: cleanName(item.name), type: item.type, visible: item.visible, parentId });
    }
    scenes.push({ id: scene.id, name: cleanName(scene.name), items });
  }
  return { activeSceneId, scenes };
}

// ---------------------------------------------------------------------------
// Commands: the only two things a mod can ask the relay to do.

export type ControlCommand =
  | { kind: 'switch_scene'; args: { sceneId: string } }
  | { kind: 'set_visibility'; args: { sceneId: string; itemId: string; visible: boolean } };

export type ControlCommandKind = ControlCommand['kind'];

/** Validates a command request. Anything but these two exact shapes is
 *  rejected — the relay only knows these two verbs, but refusing here too
 *  keeps junk out of the record. */
export function parseCommand(raw: unknown): ControlCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const args = r.args && typeof r.args === 'object' ? (r.args as Record<string, unknown>) : null;
  if (!args) return null;
  if (r.kind === 'switch_scene') {
    if (!isId(args.sceneId)) return null;
    return { kind: 'switch_scene', args: { sceneId: args.sceneId } };
  }
  if (r.kind === 'set_visibility') {
    if (!isId(args.sceneId) || !isId(args.itemId) || typeof args.visible !== 'boolean') return null;
    return { kind: 'set_visibility', args: { sceneId: args.sceneId, itemId: args.itemId, visible: args.visible } };
  }
  return null;
}

/** A command the relay hasn't picked up within this long is expired rather
 *  than run: a scene switch arriving half a minute late, after the moment has
 *  passed, is worse than one that never happens. Judged on the server's clock
 *  only — the streamer's PC clock never comes into it. */
export const COMMAND_TTL_MS = 10_000;

/** The relay heartbeats every RELAY_HEARTBEAT_MS. Chrome slows timers in a
 *  hidden tab to about once a minute, so the offline threshold leaves room for
 *  a minimised relay to miss a beat or two before mods are told it's gone. */
export const RELAY_HEARTBEAT_MS = 30_000;
export const RELAY_OFFLINE_MS = 150_000;

export function isRelayOnline(relaySeenAt: string | null | undefined, now = Date.now()): boolean {
  if (!relaySeenAt) return false;
  const seen = Date.parse(relaySeenAt);
  return Number.isFinite(seen) && now - seen < RELAY_OFFLINE_MS;
}

/** How long finished commands are kept as the record of who did what. */
export const STREAM_CONTROL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
