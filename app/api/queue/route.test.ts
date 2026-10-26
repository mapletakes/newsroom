import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from './route';

const mocks = vi.hoisted(() => ({ session: vi.fn(), process: vi.fn(), waitUntil: vi.fn(), from: vi.fn(), broadcast: vi.fn() }));
vi.mock('@/lib/session', () => ({ getApprovedSession: mocks.session, getSession: mocks.session, sessionLogin: () => 'mod' }));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }));
vi.mock('@/lib/submission-enrichment', () => ({ processSubmissionEnrichment: mocks.process, recoverSubmissionEnrichment: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil: mocks.waitUntil }));
vi.mock('@/lib/realtime', () => ({ broadcastQueueChange: mocks.broadcast }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ streamId: 'stream-1', role: 'mod', displayName: 'Moderator' });
  // Providers never finish. Approval must still return a response.
  mocks.process.mockReturnValue(new Promise(() => {}));
  mocks.from.mockImplementation(() => {
    let updating = false;
    const chain = {
      select: () => chain, eq: () => chain, neq: () => chain, limit: () => chain,
      update: () => { updating = true; return chain; },
      single: async () => ({ data: updating
        ? { id: 'submission-1', summary: null, enrichment_state: 'queued', status: 'approved' }
        : { normalized_url: 'https://example.com/story' }, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return chain;
  });
});

describe('queue approval', () => {
  it('returns saved approval while providers are still pending', async () => {
    const response = await PATCH(new NextRequest('http://localhost/api/queue', {
      method: 'PATCH', body: JSON.stringify({ id: 'submission-1', status: 'approved' }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ submission: { status: 'approved', enrichment_state: 'queued' } });
    expect(mocks.process).toHaveBeenCalledWith('submission-1', 'stream-1');
    expect(mocks.waitUntil).toHaveBeenCalledWith(mocks.process.mock.results[0].value);
    expect(mocks.broadcast).toHaveBeenCalledWith('stream-1');
  });

  it('does not launch work without an approved session', async () => {
    mocks.session.mockResolvedValue(null);
    const response = await PATCH(new NextRequest('http://localhost/api/queue', {
      method: 'PATCH', body: JSON.stringify({ id: 'submission-1', status: 'approved' }),
    }));
    expect(response.status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
