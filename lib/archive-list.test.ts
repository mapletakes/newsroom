import { describe, expect, it } from 'vitest';
import { DEFAULT_ARCHIVE_FILTERS, filterArchives, formatBytes, paginate, runBatch, type ArchiveListItem } from './archive-list';

const base: ArchiveListItem = {
  id: '1',
  title: 'Budget vote delayed',
  url: 'https://www.cbc.ca/news/politics/budget-1.234',
  publisher: 'CBC',
  kind: 'article',
  status: 'played',
  created_at: '2026-10-01T00:00:00Z',
  played_at: '2026-10-01T01:00:00Z',
  archive_url: 'https://thebroadside.net/a/abcdefghij',
  source: 'broadside',
  archived_at: '2026-10-02T00:00:00Z',
  bytes: 2048,
};
const items: ArchiveListItem[] = [
  base,
  { ...base, id: '2', title: 'Alberta referendum explainer', url: 'https://globalnews.ca/x', publisher: null, status: 'approved', archived_at: '2026-10-05T00:00:00Z' },
  { ...base, id: '3', title: null, url: 'https://youtube.com/watch?v=1', kind: 'youtube', publisher: 'YouTube', source: 'archive.today', archived_at: null, created_at: '2026-09-01T00:00:00Z' },
];
const ids = (f: Partial<typeof DEFAULT_ARCHIVE_FILTERS>) => filterArchives(items, { ...DEFAULT_ARCHIVE_FILTERS, ...f }).map((i) => i.id);

describe('filterArchives', () => {
  it('sorts newest first by capture time, falling back to submission time', () => {
    expect(ids({})).toEqual(['2', '1', '3']);
    expect(ids({ sort: 'oldest' })).toEqual(['3', '1', '2']);
  });

  it('sorts by title, using the URL when there is none', () => {
    expect(ids({ sort: 'title' })).toEqual(['2', '1', '3']);
  });

  it('matches every search term across title, publisher, URL and domain', () => {
    expect(ids({ q: 'budget' })).toEqual(['1']);
    expect(ids({ q: 'globalnews' })).toEqual(['2']);
    expect(ids({ q: 'cbc vote' })).toEqual(['1']);
    expect(ids({ q: 'cbc referendum' })).toEqual([]);
  });

  it('filters by status, source and kind', () => {
    expect(ids({ status: 'approved' })).toEqual(['2']);
    expect(ids({ source: 'archive.today' })).toEqual(['3']);
    expect(ids({ kind: 'article' })).toEqual(['2', '1']);
  });
});

describe('formatBytes', () => {
  it('formats sizes and passes through unknown', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });
});

describe('paginate', () => {
  const nums = Array.from({ length: 60 }, (_, i) => i + 1);

  it('returns the requested page and its range', () => {
    const p = paginate(nums, 2, 25);
    expect(p.pageItems[0]).toBe(26);
    expect(p.pageItems).toHaveLength(25);
    expect(p).toMatchObject({ page: 2, pageCount: 3, from: 26, to: 50 });
  });

  it('clamps out-of-range pages to the last (or first) page', () => {
    expect(paginate(nums, 9, 25)).toMatchObject({ page: 3, from: 51, to: 60 });
    expect(paginate(nums, 0, 25)).toMatchObject({ page: 1, from: 1, to: 25 });
  });

  it('handles an empty list', () => {
    expect(paginate([], 1, 25)).toMatchObject({ page: 1, pageCount: 1, from: 0, to: 0, pageItems: [] });
  });
});

describe('runBatch', () => {
  it('reports successes and failures without stopping at the first error', async () => {
    const r = await runBatch([1, 2, 3, 4, 5], async (n) => {
      if (n % 2 === 0) throw new Error('nope');
    });
    expect(r.ok.sort()).toEqual([1, 3, 5]);
    expect(r.failed.sort()).toEqual([2, 4]);
  });

  it('never runs more than the concurrency limit at once', async () => {
    let running = 0;
    let peak = 0;
    await runBatch(Array.from({ length: 12 }, (_, i) => i), async () => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 2));
      running--;
    }, 3);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty list', async () => {
    expect(await runBatch([], async () => {})).toEqual({ ok: [], failed: [] });
  });
});
