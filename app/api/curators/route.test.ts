import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  updates: [] as unknown[],
}));

vi.mock('@/lib/session', () => ({ getApprovedSession: vi.fn(async () => state.session) }));
vi.mock('@/lib/chat', () => ({ requireChat: vi.fn(async () => null) }));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.update = (patch: unknown) => {
        state.updates.push(patch);
        return chain;
      };
      chain.eq = () => chain;
      chain.then = (resolve: (v: unknown) => void) => resolve({ error: null });
      return chain;
    },
  }),
}));

import { POST } from './route';

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/curators', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  state.session = { streamId: 's1', role: 'streamer' };
  state.updates = [];
});

describe('POST /api/curators', () => {
  it('sets a stream control grant without touching any other permission', async () => {
    expect((await post({ twitchUserId: '200', canSwitchScenes: true })).status).toBe(200);
    expect(state.updates).toEqual([{ can_switch_scenes: true }]);
  });

  it('sets the source grant on its own too', async () => {
    await post({ twitchUserId: '200', canToggleSources: false });
    expect(state.updates).toEqual([{ can_toggle_sources: false }]);
  });

  it('still handles the deck permissions', async () => {
    await post({ twitchUserId: '200', canCurate: true, canSetNowPlaying: false });
    expect(state.updates).toEqual([{ can_curate: true, can_set_now_playing: false }]);
  });

  it('is for the streamer only', async () => {
    state.session = { streamId: 's1', role: 'mod' };
    expect((await post({ twitchUserId: '200', canSwitchScenes: true })).status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it('ignores grants that are not booleans', async () => {
    expect((await post({ twitchUserId: '200', canSwitchScenes: 'yes' })).status).toBe(400);
  });
});
