// The extension's "Archive this page" upload: token auth, gzip bodies, and
// attaching the snapshot to the right deck item (adding one if needed).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'zlib';
import { NextRequest } from 'next/server';

vi.mock('@/lib/ratelimit', () => ({ checkRateLimit: vi.fn(async () => ({ ok: true })), hashKey: (k: string) => k }));
vi.mock('@/lib/realtime', () => ({ broadcastQueueChange: vi.fn() }));
vi.mock('@/lib/deck-add', () => ({ addToDeck: vi.fn(async () => ({ ok: true, expanded: false, count: 1 })) }));
vi.mock('@/lib/archive-freeze', () => ({
  freezeHtml: vi.fn(async () => ({ html: '<p>frozen</p>', title: 'Captured title', finalUrl: 'u', bytes: 10 })),
}));
vi.mock('@/lib/archive', () => ({
  storeSnapshot: vi.fn(async () => 'https://thebroadside.net/a/NEWSNAP123'),
  deleteArchive: vi.fn(async () => {}),
}));

// A tiny stand-in for the Supabase query builder: each table answers
// maybeSingle() from a queue, and update() calls are recorded.
const answers: Record<string, unknown[]> = {};
const updates: { table: string; values: unknown }[] = [];
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: (answers[table] ?? []).shift() ?? null });
      q.update = (values: unknown) => {
        updates.push({ table, values });
        return q;
      };
      q.then = (resolve: (v: unknown) => void) => resolve({ error: null });
      return q;
    },
  }),
}));

import { addToDeck } from '@/lib/deck-add';
import { deleteArchive, storeSnapshot } from '@/lib/archive';
import { POST } from './route';

const STREAM = { id: 'stream-1', twitch_login: 'mike', display_name: 'Mike', approved: true };
const PAGE = { url: 'https://www.nytimes.com/2026/10/28/us/story.html', html: '<html><body>Story</body></html>' };

function post(body: unknown, { gzip = true, token = 'nr_token' } = {}) {
  const json = Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['X-Add-Token'] = token;
  if (gzip) headers['X-Content-Encoding'] = 'gzip';
  return POST(
    new NextRequest('http://localhost/api/archive/capture', {
      method: 'POST',
      headers,
      body: gzip ? gzipSync(json) : json,
    }),
  );
}

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k];
  updates.length = 0;
});
afterEach(() => vi.clearAllMocks());

describe('POST /api/archive/capture', () => {
  it('rejects a missing or unknown token', async () => {
    expect((await post(PAGE, { token: '' })).status).toBe(401);
    answers.streams = [null];
    expect((await post(PAGE)).status).toBe(401);
  });

  it('attaches a gzipped capture to the existing item and replaces its old snapshot', async () => {
    answers.streams = [STREAM];
    answers.submissions = [{ id: 'sub-1', title: 'Existing title', archive_url: 'https://thebroadside.net/a/OLDSNAP123' }];
    const res = await post(PAGE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      archive_url: 'https://thebroadside.net/a/NEWSNAP123',
      submission_id: 'sub-1',
      added: false,
    });
    expect(vi.mocked(storeSnapshot).mock.calls[0][2]).toMatchObject({ method: 'extension', submissionId: 'sub-1' });
    expect(updates).toContainEqual({ table: 'submissions', values: { archive_url: 'https://thebroadside.net/a/NEWSNAP123' } });
    expect(updates).toContainEqual({ table: 'show_notes', values: { archive_url: 'https://thebroadside.net/a/NEWSNAP123' } });
    expect(deleteArchive).toHaveBeenCalledWith(expect.anything(), 'https://thebroadside.net/a/OLDSNAP123', 'stream-1');
    expect(addToDeck).not.toHaveBeenCalled();
  });

  it('adds the page to the deck when it isn’t on the channel, titling it from the capture', async () => {
    answers.streams = [STREAM];
    answers.submissions = [null, { id: 'sub-new', title: null, archive_url: null }];
    const res = await post(PAGE, { gzip: false });
    expect(await res.json()).toMatchObject({ ok: true, submission_id: 'sub-new', added: true });
    expect(addToDeck).toHaveBeenCalledWith('stream-1', PAGE.url, 'mike', null);
    expect(updates).toContainEqual({
      table: 'submissions',
      values: { archive_url: 'https://thebroadside.net/a/NEWSNAP123', title: 'Captured title' },
    });
    expect(deleteArchive).not.toHaveBeenCalled();
  });

  it('rejects bodies without a web URL or HTML', async () => {
    answers.streams = [STREAM];
    expect((await post({ url: 'javascript:alert(1)', html: '<p>x</p>' })).status).toBe(400);
    expect((await post({ url: PAGE.url })).status).toBe(400);
  });
});
