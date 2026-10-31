// The marker route only acts for the streamer, only when the setting is on,
// and describes the marker with the item's (possibly overridden) title.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  role: 'streamer',
  channel: { twitch_user_id: '999', marker_on_open: true } as Record<string, unknown>,
  sub: { title: 'Scraped', title_override: 'Better title', url: 'https://x.test/a' },
}));

vi.mock('@/lib/session', () => ({
  getApprovedSession: vi.fn(async () => ({ streamId: 's1', role: state.role, twitchUserId: '999' })),
}));
vi.mock('@/lib/announce', () => ({ getValidAccessToken: vi.fn(async () => 'token') }));
vi.mock('@/lib/twitch-oauth', async (orig) => ({
  ...(await orig<typeof import('@/lib/twitch-oauth')>()),
  createStreamMarker: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({ data: table === 'streams' ? state.channel : state.sub });
      return chain;
    },
  }),
}));

import { createStreamMarker } from '@/lib/twitch-oauth';
import { POST } from './route';

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/deck/marker', { method: 'POST', body: JSON.stringify(body) }));

afterEach(() => {
  state.role = 'streamer';
  state.channel = { twitch_user_id: '999', marker_on_open: true };
  vi.mocked(createStreamMarker).mockClear();
});

describe('POST /api/deck/marker', () => {
  it('marks the stream with the override title', async () => {
    const res = await post({ id: 'sub-1' });
    expect(res.status).toBe(200);
    expect(createStreamMarker).toHaveBeenCalledWith('token', '999', 'Better title');
  });

  it('does nothing when the setting is off', async () => {
    state.channel = { twitch_user_id: '999', marker_on_open: false };
    const res = await post({ id: 'sub-1' });
    expect(await res.json()).toEqual({ ok: true, skipped: 'disabled' });
    expect(createStreamMarker).not.toHaveBeenCalled();
  });

  it('refuses mods', async () => {
    state.role = 'mod';
    expect((await post({ id: 'sub-1' })).status).toBe(403);
    expect(createStreamMarker).not.toHaveBeenCalled();
  });

  it('asks the streamer to reconnect when Twitch rejects the token scope', async () => {
    vi.mocked(createStreamMarker).mockResolvedValueOnce({ ok: false, reason: 'reconnect' });
    const res = await post({ id: 'sub-1' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('reconnect');
  });

  it('reports a non-live stream without failing', async () => {
    vi.mocked(createStreamMarker).mockResolvedValueOnce({ ok: false, reason: 'offline' });
    const res = await post({ id: 'sub-1' });
    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe('offline');
  });
});
