import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwitchApiError, fetchModeratedChannels } from './twitch-oauth';

function page(channels: string[], cursor?: string) {
  return new Response(
    JSON.stringify({
      data: channels.map((id) => ({ broadcaster_id: id, broadcaster_login: `l${id}`, broadcaster_name: `N${id}` })),
      pagination: cursor ? { cursor } : {},
    }),
    { status: 200 },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchModeratedChannels', () => {
  it('follows pagination to collect every channel', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page(['1', '2'], 'next')).mockResolvedValueOnce(page(['3']));
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetchModeratedChannels('tok', 'u1');

    expect(out.map((c) => c.broadcaster_id)).toEqual(['1', '2', '3']);
    expect(String(fetchMock.mock.calls[1][0])).toContain('after=next');
  });

  it('by default quietly returns what it has when Twitch refuses (sign-in must not break on this)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    expect(await fetchModeratedChannels('tok', 'u1')).toEqual([]);
  });

  it('in strict mode, throws a TwitchApiError carrying the status instead of reading as "moderates nothing"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));

    const err = await fetchModeratedChannels('tok', 'u1', { strict: true }).catch((e) => e);

    expect(err).toBeInstanceOf(TwitchApiError);
    expect(err.status).toBe(401);
  });

  it('in strict mode, still returns an honestly empty list when Twitch says there are none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page([])));
    expect(await fetchModeratedChannels('tok', 'u1', { strict: true })).toEqual([]);
  });
});
