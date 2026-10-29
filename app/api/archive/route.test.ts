// Captures cost storage and bandwidth, so POST only archives when the
// request says it came from an archive button (manual: true).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/session', () => ({
  getApprovedSession: vi.fn(async () => ({ streamId: 'stream-1', accountId: '1', displayName: 'Mike', role: 'streamer' })),
}));
vi.mock('@/lib/realtime', () => ({ broadcastQueueChange: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
vi.mock('@/lib/archive', () => ({
  createArchive: vi.fn(async () => ({ url: 'https://thebroadside.net/a/abcdefghij', refused: false, waybackRequested: false })),
  deleteArchive: vi.fn(),
  archiveSlugFromUrl: vi.fn(() => null),
}));
vi.mock('@/lib/supabase', () => {
  // Just enough of the query builder for the route: select…eq…eq…maybeSingle,
  // and update…eq.
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.update = () => chain;
  chain.maybeSingle = async () => ({ data: { url: 'https://example.com/story', archive_url: null } });
  chain.then = (resolve: (v: unknown) => void) => resolve({ error: null });
  return { supabaseAdmin: () => ({ from: () => chain }) };
});

import { createArchive } from '@/lib/archive';
import { POST } from './route';

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  vi.mocked(createArchive).mockClear();
});

describe('POST /api/archive', () => {
  it('refuses to archive without manual: true', async () => {
    const res = await post({ id: 'sub-1' });
    expect(res.status).toBe(400);
    expect(createArchive).not.toHaveBeenCalled();
  });

  it('archives when started from a button', async () => {
    const res = await post({ id: 'sub-1', manual: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      archive_url: 'https://thebroadside.net/a/abcdefghij',
      refused: false,
      wayback_requested: false,
    });
    expect(createArchive).toHaveBeenCalledOnce();
  });
});
