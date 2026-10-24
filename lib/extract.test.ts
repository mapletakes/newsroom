import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractSubmissionFields, runBasicExtraction } from './extract';

const mocks = vi.hoisted(() => ({ meta: vi.fn(), enrich: vi.fn(), usage: vi.fn(), from: vi.fn() }));
vi.mock('./extract-kind', () => ({ extractMetaForKind: mocks.meta, enrichExtractedMeta: mocks.enrich }));
vi.mock('./usage', () => ({ recordUsage: mocks.usage }));
vi.mock('./supabase', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }));
const sub = { id: 'item-1', stream_id: 'stream-1', kind: 'article', url: 'https://example.com/story' };
let writes: { fields: Record<string, unknown>; filters: Record<string, unknown> }[];

beforeEach(() => {
  vi.resetAllMocks();
  writes = [];
  mocks.meta.mockResolvedValue({ title: 'Fetched title', description: 'A description', thumbnail: null, publisher: 'Example', author: null, publishedAt: null, duration: null, bodyText: 'Article body' });
  mocks.enrich.mockResolvedValue({ summary: 'Summary', credibility: 'unknown', topics: ['test'], dmcaRisk: 'medium', contentWarning: null });
  mocks.from.mockImplementation(() => {
    let write: (typeof writes)[number] | null = null;
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { if (write) write.filters[key] = value; return chain; },
      single: async () => ({ data: sub, error: null }),
      update: (fields: Record<string, unknown>) => { write = { fields, filters: {} }; writes.push(write); return chain; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    };
    return chain;
  });
});

describe('submission extraction', () => {
  it('keeps metadata and free risk signals when the AI provider fails', async () => {
    mocks.enrich.mockResolvedValue({ summary: null, failureReason: 'AI unavailable' });
    const result = await extractSubmissionFields(sub, true);
    expect(result).toMatchObject({ fields: { title: 'Fetched title', description: 'A description', dmca_risk: 'low' }, failureReason: 'AI unavailable' });
    expect(result.fields).not.toHaveProperty('summary');
    expect(result.fields).not.toHaveProperty('mod_notes');
  });

  it('returns successful AI fields without writing before the worker can fence completion', async () => {
    const result = await extractSubmissionFields(sub, true);
    expect(result.fields).toMatchObject({ summary: 'Summary', dmca_risk: 'medium', topics: ['test'] });
    expect(writes).toEqual([]);
  });

  it('guards pending metadata writes so they cannot overwrite an approved item’s AI signals', async () => {
    await runBasicExtraction(sub.id);
    expect(mocks.enrich).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(writes[0].filters).toEqual({ id: sub.id, status: 'pending' });
    expect(writes[0].fields).not.toHaveProperty('summary');
  });
});
