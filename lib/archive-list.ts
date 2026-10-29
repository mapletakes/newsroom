// Shape and client-side filtering for the /archives page. Kept apart from
// lib/archive.ts, which pulls in server-only code (crypto, the freezer), so
// the page can import it.

export type ArchiveSource = 'broadside' | 'archive.today';
export type ArchiveStatus = 'pending' | 'approved' | 'rejected' | 'played';

export type ArchiveListItem = {
  id: string; // the submission id
  title: string | null;
  url: string;
  publisher: string | null;
  kind: string;
  status: ArchiveStatus;
  created_at: string;
  played_at: string | null;
  archive_url: string;
  source: ArchiveSource;
  archived_at: string | null; // only known for our own snapshots
  bytes: number | null;
};

export type ArchiveSort = 'newest' | 'oldest' | 'title';

export type ArchiveFilters = {
  q: string;
  status: ArchiveStatus | 'all';
  source: ArchiveSource | 'all';
  kind: string; // 'all' or a media kind
  sort: ArchiveSort;
};

export const DEFAULT_ARCHIVE_FILTERS: ArchiveFilters = {
  q: '',
  status: 'all',
  source: 'all',
  kind: 'all',
  sort: 'newest',
};

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** When the item was archived, as best we know: our snapshot's own capture
 *  time, else when the item was submitted (archive.today fallbacks don't
 *  record a capture time). */
export function archivedWhen(item: ArchiveListItem): string {
  return item.archived_at ?? item.created_at;
}

/** Every whitespace-separated term must match somewhere in the title,
 *  publisher, URL or domain, case-insensitively. */
export function filterArchives(items: ArchiveListItem[], f: ArchiveFilters): ArchiveListItem[] {
  const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = items.filter((it) => {
    if (f.status !== 'all' && it.status !== f.status) return false;
    if (f.source !== 'all' && it.source !== f.source) return false;
    if (f.kind !== 'all' && it.kind !== f.kind) return false;
    if (!terms.length) return true;
    const hay = [it.title, it.publisher, it.url, hostOf(it.url)].filter(Boolean).join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const byTime = (a: ArchiveListItem, b: ArchiveListItem) =>
    new Date(archivedWhen(b)).getTime() - new Date(archivedWhen(a)).getTime();
  if (f.sort === 'newest') out.sort(byTime);
  else if (f.sort === 'oldest') out.sort((a, b) => byTime(b, a));
  else out.sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url, undefined, { sensitivity: 'base' }));
  return out;
}

export function formatBytes(n: number | null): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
