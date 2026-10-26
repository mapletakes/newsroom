import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimSubmissionEnrichment, processSubmissionEnrichment, recoverSubmissionEnrichment, runSubmissionEnrichment, type EnrichmentJob } from './submission-enrichment';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(), update: vi.fn(), extract: vi.fn(), coverage: vi.fn(), broadcast: vi.fn(), from: vi.fn(),
}));
vi.mock('./supabase', () => ({ supabaseAdmin: () => ({ rpc: () => ({ maybeSingle: mocks.claim }), from: mocks.from }) }));
vi.mock('./extract', () => ({ extractSubmissionFields: mocks.extract }));
vi.mock('./search-coverage', () => ({ searchRelatedCoverage: mocks.coverage }));
vi.mock('./realtime', () => ({ broadcastQueueChange: mocks.broadcast }));

const job: EnrichmentJob = {
  id: 'submission-1', stream_id: 'stream-1', url: 'https://example.com/story', kind: 'article',
  title: 'Story title', publisher: 'Example', related_coverage: null, enrichment_token: 'lease-1',
};
let writes: { patch: Record<string, unknown>; filters: Record<string, unknown> }[];
let recoveredRows: { id: string; stream_id: string }[];
let recoveryFilters: Record<string, unknown>;

afterEach(() => { vi.restoreAllMocks(); });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  writes = []; recoveredRows = []; recoveryFilters = {};
  mocks.claim.mockResolvedValue({ data: job, error: null });
  mocks.extract.mockResolvedValue({ fields: { summary: 'A summary', title: 'Fresh title', content_warning: null } });
  mocks.coverage.mockResolvedValue([{ title: 'Other coverage', url: 'https://other.example/story' }]);
  mocks.update.mockResolvedValue({ error: null });
  mocks.from.mockImplementation((table: string) => ({
    update: (patch: Record<string, unknown>) => {
      const write = { patch, filters: {} as Record<string, unknown> };
      writes.push(write);
      const chain = {
        eq: (key: string, value: unknown) => { write.filters[key] = value; return chain; },
        then: (resolve: (value: unknown) => unknown) => mocks.update().then(resolve),
      };
      return chain;
    },
    select: () => {
      const chain = {
        eq: (key: string, value: unknown) => { recoveryFilters[key] = value; return chain; },
        not: (key: string, operator: string, value: unknown) => { recoveryFilters[key] = { operator, value }; return chain; },
        is: (key: string, value: unknown) => { recoveryFilters[key] = value; return chain; },
        or: (value: string) => { recoveryFilters.or = value; return chain; },
        order: () => chain,
        limit: (value: number) => { recoveryFilters.limit = value; return chain; },
        single: async () => ({ data: { preferred_sources: ['other.example'] } }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'submissions' ? recoveredRows : null, error: null }).then(resolve),
      };
      return chain;
    },
  }));
});

describe('submission enrichment worker', () => {
  it('does no paid work when another invocation owns the lease', async () => {
    mocks.claim.mockResolvedValue({ data: null, error: null });
    await processSubmissionEnrichment(job.id, job.stream_id);
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.coverage).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('saves fresh fields and related coverage under the claimed lease', async () => {
    await runSubmissionEnrichment(job);
    expect(mocks.coverage).toHaveBeenCalledWith(expect.objectContaining({ title: 'Fresh title', streamId: 'stream-1' }));
    expect(writes[0].patch).toMatchObject({ summary: 'A summary', enrichment_state: 'complete', enrichment_token: null });
    expect(writes[0].filters).toEqual({ id: job.id, stream_id: job.stream_id, enrichment_token: job.enrichment_token });
    expect(mocks.broadcast).toHaveBeenCalledWith(job.stream_id);
  });

  it('does not search for non-articles or coverage already recorded', async () => {
    await runSubmissionEnrichment({ ...job, kind: 'youtube' });
    await runSubmissionEnrichment({ ...job, related_coverage: [] });
    expect(mocks.coverage).not.toHaveBeenCalled();
  });

  it('marks tweets skipped so their intentionally absent summaries do not cause repeated work', async () => {
    mocks.extract.mockResolvedValue({ fields: { summary: null } });
    await runSubmissionEnrichment({ ...job, kind: 'twitter' });
    expect(writes[0].patch.enrichment_state).toBe('skipped');
  });

  it('records retryable failures without overwriting editorial notes or exposing provider errors', async () => {
    mocks.extract.mockRejectedValue(new Error('secret provider response'));
    await runSubmissionEnrichment(job);
    expect(writes).toHaveLength(1);
    expect(writes[0].patch).toMatchObject({ enrichment_state: 'failed', enrichment_token: null });
    expect(writes[0].patch).not.toHaveProperty('mod_notes');
    expect(JSON.stringify(writes[0].patch)).not.toContain('secret provider response');
    expect(writes[0].filters.enrichment_token).toBe(job.enrichment_token);
  });

  it('keeps metadata and free signals when AI cannot produce a summary', async () => {
    mocks.extract.mockResolvedValue({ fields: { title: 'Fetched title', dmca_risk: 'low' }, failureReason: 'AI unavailable' });
    await runSubmissionEnrichment(job);
    expect(writes[0].patch).toMatchObject({ title: 'Fetched title', dmca_risk: 'low', enrichment_state: 'failed' });
    expect(writes[0].patch).not.toHaveProperty('summary');
    expect(mocks.coverage).not.toHaveBeenCalled();
  });

  it('records a failed database write instead of claiming completion', async () => {
    mocks.update.mockResolvedValueOnce({ error: { message: 'write failed' } }).mockResolvedValueOnce({ error: null });
    await runSubmissionEnrichment(job);
    expect(writes[1].patch.enrichment_state).toBe('failed');
    expect(writes[1].filters.enrichment_token).toBe(job.enrichment_token);
  });

  it('leaves persisted work recoverable when claiming fails', async () => {
    mocks.claim.mockResolvedValue({ data: null, error: { message: 'database unavailable' } });
    await expect(processSubmissionEnrichment(job.id, job.stream_id)).resolves.toBeUndefined();
    expect(mocks.extract).not.toHaveBeenCalled();
    await expect(claimSubmissionEnrichment(job.id, job.stream_id)).rejects.toThrow('Could not claim enrichment work.');
  });

  it('recovers a bounded batch of queued and expired work scoped to the viewed stream', async () => {
    recoveredRows = [{ id: job.id, stream_id: job.stream_id }];
    await recoverSubmissionEnrichment(job.stream_id);
    expect(recoveryFilters).toMatchObject({ status: 'approved', stream_id: job.stream_id, limit: 3, summary: null, 'streams.approved': { operator: 'is', value: false } });
    expect(recoveryFilters.or).toContain('enrichment_state.eq.queued,and(enrichment_state.eq.running');
    expect(mocks.extract).toHaveBeenCalledOnce();
  });
});
