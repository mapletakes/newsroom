import { describe, expect, it } from 'vitest';
import { DEFAULT_ARCHIVE_FILTERS, filterArchives, formatBytes, type ArchiveListItem } from './archive-list';

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
