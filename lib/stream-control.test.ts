import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  stream: null as Record<string, unknown> | null,
  mod: null as Record<string, unknown> | null,
}));

vi.mock('./supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({ data: table === 'streams' ? state.stream : state.mod });
      return chain;
    },
  }),
}));

import {
  MAX_ITEMS_PER_SCENE,
  MAX_NAME_LENGTH,
  MAX_SCENES,
  RELAY_OFFLINE_MS,
  accessAllows,
  getStreamControlAccess,
  isRelayOnline,
  parseCommand,
  parseSnapshot,
} from './stream-control';
import type { Session } from './session';

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Item ${id}`,
  type: 'item',
  visible: true,
  parentId: null,
  ...extra,
});
const scene = (id: string, items: unknown[] = []) => ({ id, name: `Scene ${id}`, items });

describe('parseSnapshot', () => {
  it('accepts a well-formed snapshot and drops unknown fields', () => {
    const out = parseSnapshot({
      activeSceneId: 's1',
      extra: 'x',
      scenes: [scene('s1', [item('a', { resourceId: 'secret' }), item('f', { type: 'folder' }), item('b', { parentId: 'f', visible: false })])],
    });
    expect(out).toEqual({
      activeSceneId: 's1',
      scenes: [
        {
          id: 's1',
          name: 'Scene s1',
          items: [
            { id: 'a', name: 'Item a', type: 'item', visible: true, parentId: null },
            { id: 'f', name: 'Item f', type: 'folder', visible: true, parentId: null },
            { id: 'b', name: 'Item b', type: 'item', visible: false, parentId: 'f' },
          ],
        },
      ],
    });
  });

  it('keeps duplicate item names apart by id', () => {
    const out = parseSnapshot({ activeSceneId: 's1', scenes: [scene('s1', [item('a', { name: 'Social Media' }), item('b', { name: 'Social Media' })])] });
    expect(out?.scenes[0].items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('drops repeated scene and item ids, keeping the first', () => {
    const out = parseSnapshot({
      activeSceneId: 's1',
      scenes: [scene('s1', [item('a'), item('a', { name: 'again' })]), scene('s2'), { ...scene('s1'), name: 'dup' }],
    });
    expect(out?.scenes.map((s) => s.name)).toEqual(['Scene s1', 'Scene s2']);
    expect(out?.scenes[0].items.map((i) => i.name)).toEqual(['Item a']);
  });

  it('allows no active scene', () => {
    expect(parseSnapshot({ scenes: [] })).toEqual({ activeSceneId: null, scenes: [] });
  });

  it('truncates long names', () => {
    const out = parseSnapshot({ activeSceneId: null, scenes: [scene('s1', [item('a', { name: 'x'.repeat(MAX_NAME_LENGTH + 50) })])] });
    expect(out?.scenes[0].items[0].name).toHaveLength(MAX_NAME_LENGTH);
  });

  it.each([
    ['not an object', 'nope'],
    ['scenes missing', { activeSceneId: 's1' }],
    ['bad active id', { activeSceneId: 5, scenes: [] }],
    ['scene without id', { scenes: [{ name: 'x', items: [] }] }],
    ['item with unknown type', { scenes: [scene('s1', [item('a', { type: 'filter' })])] }],
    ['item visible not boolean', { scenes: [scene('s1', [item('a', { visible: 'yes' })])] }],
    ['item without id', { scenes: [scene('s1', [item('', {})])] }],
    ['too many scenes', { scenes: Array.from({ length: MAX_SCENES + 1 }, (_, i) => scene(`s${i}`)) }],
    ['too many items', { scenes: [scene('s1', Array.from({ length: MAX_ITEMS_PER_SCENE + 1 }, (_, i) => item(`i${i}`)))] }],
  ])('rejects %s', (_label, raw) => {
    expect(parseSnapshot(raw)).toBeNull();
  });
});

describe('parseCommand', () => {
  it('accepts a scene switch', () => {
    expect(parseCommand({ kind: 'switch_scene', args: { sceneId: 's1', extra: 1 } })).toEqual({
      kind: 'switch_scene',
      args: { sceneId: 's1' },
    });
  });

  it('accepts a visibility change', () => {
    expect(parseCommand({ kind: 'set_visibility', args: { sceneId: 's1', itemId: 'a', visible: false } })).toEqual({
      kind: 'set_visibility',
      args: { sceneId: 's1', itemId: 'a', visible: false },
    });
  });

  it.each([
    ['delete', { kind: 'remove_scene', args: { sceneId: 's1' } }],
    ['no args', { kind: 'switch_scene' }],
    ['visibility without boolean', { kind: 'set_visibility', args: { sceneId: 's1', itemId: 'a', visible: 'false' } }],
    ['visibility without item', { kind: 'set_visibility', args: { sceneId: 's1', visible: true } }],
    ['null', null],
  ])('rejects %s', (_label, raw) => {
    expect(parseCommand(raw)).toBeNull();
  });
});

describe('isRelayOnline', () => {
  const now = Date.parse('2026-11-26T20:00:00Z');
  it('is online inside the window', () => {
    expect(isRelayOnline(new Date(now - RELAY_OFFLINE_MS + 1000).toISOString(), now)).toBe(true);
  });
  it('is offline outside it, or with no heartbeat', () => {
    expect(isRelayOnline(new Date(now - RELAY_OFFLINE_MS - 1).toISOString(), now)).toBe(false);
    expect(isRelayOnline(null, now)).toBe(false);
    expect(isRelayOnline('garbage', now)).toBe(false);
  });
});

describe('getStreamControlAccess', () => {
  const streamer = { streamId: 'st', role: 'streamer', twitchUserId: '100' } as Session;
  const mod = { streamId: 'st', role: 'mod', twitchUserId: '200' } as Session;

  beforeEach(() => {
    vi.clearAllMocks();
    state.stream = { stream_control_enabled: true, twitch_user_id: '100' };
    state.mod = { can_switch_scenes: true, can_toggle_sources: false };
  });

  it('gives nobody anything with the module off', async () => {
    state.stream = { stream_control_enabled: false, twitch_user_id: '100' };
    expect(await getStreamControlAccess(streamer)).toMatchObject({ enabled: false, canRunRelay: false, canSwitchScenes: false });
    expect(await getStreamControlAccess(mod)).toMatchObject({ enabled: false, canSwitchScenes: false });
  });

  it('gives the streamer everything, including the relay', async () => {
    expect(await getStreamControlAccess(streamer)).toEqual({
      enabled: true,
      canSwitchScenes: true,
      canToggleSources: true,
      canRunRelay: true,
    });
  });

  it('gives a current mod exactly their grants, never the relay', async () => {
    expect(await getStreamControlAccess(mod)).toEqual({
      enabled: true,
      canSwitchScenes: true,
      canToggleSources: false,
      canRunRelay: false,
    });
  });

  it('gives a mod with no grants nothing', async () => {
    state.mod = { can_switch_scenes: false, can_toggle_sources: false };
    expect(await getStreamControlAccess(mod)).toMatchObject({ enabled: true, canSwitchScenes: false, canToggleSources: false });
  });

  it('gives a mod with no row nothing', async () => {
    state.mod = null;
    expect(await getStreamControlAccess(mod)).toMatchObject({ canSwitchScenes: false, canToggleSources: false });
  });

  it('denies a mod session with no Twitch identity', async () => {
    expect(await getStreamControlAccess({ ...mod, twitchUserId: undefined })).toMatchObject({ canSwitchScenes: false });
  });
});

describe('accessAllows', () => {
  const access = { enabled: true, canSwitchScenes: true, canToggleSources: false, canRunRelay: false };
  it('maps each command kind to its grant', () => {
    expect(accessAllows(access, 'switch_scene')).toBe(true);
    expect(accessAllows(access, 'set_visibility')).toBe(false);
  });
});
