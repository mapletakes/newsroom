import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMarkerDescription } from './marker';
import { createStreamMarker, MAX_MARKER_DESCRIPTION } from './twitch-oauth';

describe('buildMarkerDescription', () => {
  it('uses the title, falling back to the url', () => {
    expect(buildMarkerDescription('Budget vote delayed', 'https://x.test/a')).toBe('Budget vote delayed');
    expect(buildMarkerDescription(null, 'https://x.test/a')).toBe('https://x.test/a');
  });

  it('collapses whitespace and stays within Twitch’s limit', () => {
    expect(buildMarkerDescription('  two\n lines  ', 'u')).toBe('two lines');
    const long = buildMarkerDescription('word '.repeat(100), 'u');
    expect(long.length).toBeLessThanOrEqual(MAX_MARKER_DESCRIPTION);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('createStreamMarker', () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (status: number) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));

  it('posts the broadcaster id and a capped description', async () => {
    respond(200);
    const r = await createStreamMarker('tok', '123', 'x'.repeat(300));
    expect(r).toEqual({ ok: true });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe('https://api.twitch.tv/helix/streams/markers');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.user_id).toBe('123');
    expect(body.description).toHaveLength(MAX_MARKER_DESCRIPTION);
  });

  it('maps missing scope to reconnect and a non-live stream to offline', async () => {
    respond(401);
    expect(await createStreamMarker('t', '1', 'd')).toMatchObject({ ok: false, reason: 'reconnect' });
    respond(403);
    expect(await createStreamMarker('t', '1', 'd')).toMatchObject({ ok: false, reason: 'reconnect' });
    respond(404);
    expect(await createStreamMarker('t', '1', 'd')).toMatchObject({ ok: false, reason: 'offline' });
    respond(500);
    expect(await createStreamMarker('t', '1', 'd')).toMatchObject({ ok: false, reason: 'failed' });
  });
});
