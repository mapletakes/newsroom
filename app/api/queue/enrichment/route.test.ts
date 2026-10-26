import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const mocks = vi.hoisted(() => ({ session: vi.fn(), claim: vi.fn(), run: vi.fn(), waitUntil: vi.fn() }));
vi.mock('@/lib/session', () => ({ getApprovedSession: mocks.session }));
vi.mock('@/lib/submission-enrichment', () => ({ claimSubmissionEnrichment: mocks.claim, runSubmissionEnrichment: mocks.run }));
vi.mock('@vercel/functions', () => ({ waitUntil: mocks.waitUntil }));
const id = '00000000-0000-4000-8000-000000000001';
const request = (body: unknown) => new NextRequest('http://localhost/api/queue/enrichment', {
  method: 'POST', body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ streamId: 'stream-1' });
  mocks.claim.mockResolvedValue({ id, enrichment_token: 'lease-1' });
  mocks.run.mockReturnValue(new Promise(() => {}));
});

describe('enrichment retry', () => {
  it('claims work in the session channel and responds before processing finishes', async () => {
    const response = await POST(request({ id, streamId: 'foreign-stream' }));
    expect(response.status).toBe(202);
    expect(mocks.claim).toHaveBeenCalledWith(id, 'stream-1', true);
    expect(mocks.waitUntil).toHaveBeenCalledWith(mocks.run.mock.results[0].value);
  });

  it('refuses an unauthenticated retry', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(request({ id }))).status).toBe(401);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it.each([{}, { id: 'not-a-uuid' }, { id: 123 }])('rejects malformed input %j', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('does not launch another worker for an unclaimable item', async () => {
    mocks.claim.mockResolvedValue(null);
    expect((await POST(request({ id }))).status).toBe(409);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('returns a retryable error when the database is unavailable', async () => {
    mocks.claim.mockRejectedValue(new Error('private connection details'));
    const response = await POST(request({ id }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private connection details');
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
