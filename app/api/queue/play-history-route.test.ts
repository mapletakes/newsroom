import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from './route';

const mocks = vi.hoisted(() => ({ session: vi.fn(), from: vi.fn(), broadcast: vi.fn(), enrich: vi.fn() }));
vi.mock('@/lib/session', () => ({ getApprovedSession: mocks.session, getSession: mocks.session, sessionLogin: () => 'streamer' }));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }));
vi.mock('@/lib/extract', () => ({ runAiEnrichment: mocks.enrich }));
vi.mock('@/lib/realtime', () => ({ broadcastQueueChange: mocks.broadcast }));
let patch: Record<string, unknown>;
let filters: Record<string, unknown>;
let writeError: { message: string } | null;
const request = (body: Record<string, unknown>) => new NextRequest('http://localhost/api/queue', {
  method: 'PATCH', body: JSON.stringify({ id: 'submission-1', ...body }),
});

beforeEach(() => {
  vi.resetAllMocks(); patch = {}; filters = {}; writeError = null;
  mocks.session.mockResolvedValue({ streamId: 'stream-1', role: 'streamer', displayName: 'Streamer' });
  mocks.from.mockImplementation((table: string) => {
    if (table === 'show_notes') throw new Error('The API must not write a second note outside the play transaction');
    const chain = {
      select: () => chain,
      update: (value: Record<string, unknown>) => { patch = value; return chain; },
      eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
      neq: () => chain, limit: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: { id: 'submission-1', status: patch.status, kind: 'youtube', summary: 'Saved summary', played_at: '2026-10-13T22:00:00Z' }, error: writeError }),
    };
    return chain;
  });
});

describe('transactional play history API', () => {
  it('passes the takeaway into the atomic status update and uses the database play time', async () => {
    const response = await PATCH(request({ status: 'played', takeaway: ' A useful note ', duration_on_screen_s: 12 }));
    expect(response.status).toBe(200);
    expect(patch).toMatchObject({ status: 'played', prep_note: 'A useful note', duration_on_screen_s: 12 });
    expect(patch).not.toHaveProperty('played_at');
    expect(filters.stream_id).toBe('stream-1');
    expect(mocks.from).not.toHaveBeenCalledWith('show_notes');
    expect(await response.json()).toMatchObject({ submission: { played_at: '2026-10-13T22:00:00Z' } });
  });

  it('allows an explicitly empty takeaway without keeping the old note', async () => {
    await PATCH(request({ status: 'played', takeaway: null }));
    expect(patch.prep_note).toBeNull();
  });

  it('returns failure when the database cannot commit the play and its note', async () => {
    writeError = { message: 'Injected transactional note failure' };
    expect((await PATCH(request({ status: 'played' }))).status).toBe(500);
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it('leaves note cancellation to the same database transaction as Undo', async () => {
    expect((await PATCH(request({ status: 'approved' }))).status).toBe(200);
    expect(mocks.from).not.toHaveBeenCalledWith('show_notes');
    expect(mocks.broadcast).toHaveBeenCalledWith('stream-1');
  });

  it('refuses play mutations without an approved session', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await PATCH(request({ status: 'played' }))).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
