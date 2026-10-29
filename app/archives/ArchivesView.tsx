'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Icon } from '@/components/ui/icon';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { KIND_LABELS } from '@/components/SubmissionCard';
import { formatDateTime, relativeTime } from '@/lib/url';
import { queryKeys } from '@/lib/query-keys';
import {
  ARCHIVE_PAGE_SIZES,
  DEFAULT_ARCHIVE_FILTERS,
  archivedWhen,
  filterArchives,
  formatBytes,
  hostOf,
  paginate,
  refusedMessage,
  runBatch,
  type ArchiveFilters,
  type ArchiveListItem,
} from '@/lib/archive-list';

type ArchivesResponse = { items: ArchiveListItem[]; truncated: boolean };

async function fetchArchives(): Promise<ArchivesResponse> {
  const r = await fetch('/api/archive');
  if (!r.ok) throw new Error('Failed to load archives');
  return r.json();
}

const STATUS_LABELS: Record<string, string> = {
  played: 'Played',
  approved: 'On deck',
  pending: 'Pending',
  rejected: 'Rejected',
};

const selectClass =
  'border border-ink/30 bg-paper px-2 py-1.5 font-mono text-sm focus:outline-none focus:border-ink';

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[11px] uppercase tracking-widest text-ink/60">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function ArchiveRow({
  item,
  busy,
  selected,
  onSelect,
  onCopy,
  onRecapture,
  onDelete,
}: {
  item: ArchiveListItem;
  busy: boolean;
  selected: boolean;
  // `range` is true for a shift-click: select everything since the last click.
  onSelect: (range: boolean) => void;
  onCopy: () => void;
  onRecapture: () => void;
  onDelete: () => void;
}) {
  const when = archivedWhen(item);
  const action = 'uppercase tracking-widest text-ink/60 hover:text-ink disabled:opacity-60';
  // Two lines per card: the title (one line, full URL on hover) with the
  // actions beside it, then a single meta line. The publisher/domain stands
  // in for the full URL, which lives in the title's tooltip.
  return (
    <Card className={`flex items-center gap-3 px-3 py-2 ${selected ? 'border-ink bg-ink/5' : ''}`}>
      <input
        type="checkbox"
        checked={selected}
        // onClick, not onChange, because only the click carries Shift (and
        // Space on a focused checkbox fires one too).
        onClick={(e) => onSelect(e.shiftKey)}
        onChange={() => {}}
        aria-label={`Select ${item.title || item.url}`}
        className="h-4 w-4 shrink-0 accent-rust"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-y-1 sm:flex-row sm:items-center sm:gap-x-4">
        <div className="min-w-0 flex-1">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            title={item.url}
            className="block truncate font-display text-base font-bold leading-tight hover:text-rust hover:underline"
          >
            {item.title || item.url}
          </a>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] leading-4 text-ink/60">
            <Badge variant="outline" className="px-1 py-0 text-[10px] leading-4">
              {KIND_LABELS[item.kind] || item.kind}
            </Badge>
            <span className="text-ink/80">{item.publisher || hostOf(item.url)}</span>
            <span>·</span>
            <span>
              {item.status === 'played' && item.played_at
                ? `Played ${formatDateTime(item.played_at)}`
                : STATUS_LABELS[item.status] || item.status}
            </span>
            <span>·</span>
            <span title={new Date(when).toLocaleString()}>
              {item.archived_at ? 'Archived' : 'Submitted'} {relativeTime(when)}
            </span>
            {item.bytes != null && (
              <>
                <span>·</span>
                <span>{formatBytes(item.bytes)}</span>
              </>
            )}
            {item.source === 'archive.today' && (
              <Badge
                variant="warning"
                className="border px-1 py-0 text-[10px] leading-4"
                title="Our own capture failed, so this links to archive.today instead"
              >
                archive.today fallback
              </Badge>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 font-mono text-[11px]">
          <a
            href={item.archive_url}
            target="_blank"
            rel="noreferrer"
            className="uppercase tracking-widest text-moss hover:underline inline-flex items-center gap-1"
            title="View the archived snapshot"
          >
            <Icon name="camera" />
            Snapshot ↗
          </a>
          <button type="button" onClick={onCopy} className={action} title="Copy the snapshot link">
            Copy
          </button>
          {item.source === 'archive.today' && (
            <button
              type="button"
              onClick={onRecapture}
              disabled={busy}
              className={action}
              title="Try capturing this page with The Broadside's own archiver"
            >
              {busy ? 'Capturing…' : 'Re-capture'}
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="uppercase tracking-widest text-ink/50 hover:text-rust disabled:opacity-60"
          >
            Delete
          </button>
        </div>
      </div>
    </Card>
  );
}

export function ArchivesView({
  displayName,
  isAdmin,
  chatEnabled,
  isMod,
}: {
  displayName: string;
  isAdmin: boolean;
  chatEnabled: boolean;
  isMod: boolean;
}) {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [filters, setFilters] = useState<ArchiveFilters>(DEFAULT_ARCHIVE_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(ARCHIVE_PAGE_SIZES[0]);
  const listTop = useRef<HTMLDivElement>(null);
  // Any change to what's being looked at starts again from the first page.
  // A selection also ends with the view it was made in, so a bulk action can
  // never reach rows the filters have hidden.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClicked = useRef<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const set = <K extends keyof ArchiveFilters>(k: K, v: ArchiveFilters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
    setSelected(new Set());
  };
  const clearFilters = () => {
    setFilters(DEFAULT_ARCHIVE_FILTERS);
    setPage(1);
    setSelected(new Set());
  };
  const goTo = (p: number) => {
    setPage(p);
    listTop.current?.scrollIntoView({ block: 'start' });
  };

  const { data, isPending, isError } = useQuery({ queryKey: queryKeys.archives(), queryFn: fetchArchives });
  const items = useMemo(() => data?.items ?? [], [data]);
  const shown = useMemo(() => filterArchives(items, filters), [items, filters]);
  const paged = paginate(shown, page, pageSize);
  const kinds = useMemo(() => [...new Set(items.map((i) => i.kind))].sort(), [items]);
  const fallbackCount = items.filter((i) => i.source === 'archive.today').length;
  const filtered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_ARCHIVE_FILTERS);

  const [busyId, setBusyId] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.archives() });

  const selectedItems = useMemo(() => shown.filter((i) => selected.has(i.id)), [shown, selected]);
  const pageIds = paged.pageItems.map((i) => i.id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const select = (item: ArchiveListItem, range: boolean) => {
    // Read the anchor now: the updater below runs later, after it's moved.
    const anchor = range ? lastClicked.current : null;
    setSelected((cur) => {
      const next = new Set(cur);
      const want = !cur.has(item.id);
      const ids = paged.pageItems.map((i) => i.id);
      const from = anchor ? ids.indexOf(anchor) : -1;
      if (from >= 0) {
        const [a, b] = [from, ids.indexOf(item.id)].sort((x, y) => x - y);
        ids.slice(a, b + 1).forEach((id) => (want ? next.add(id) : next.delete(id)));
      } else if (want) next.add(item.id);
      else next.delete(item.id);
      return next;
    });
    lastClicked.current = item.id;
  };
  const togglePage = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      pageIds.forEach((id) => (pageAllSelected ? next.delete(id) : next.add(id)));
      return next;
    });

  const deleteSelected = async () => {
    const targets = selectedItems;
    if (!targets.length || batchBusy) return;
    const own = targets.filter((i) => i.source === 'broadside').length;
    const n = targets.length;
    const ok = await confirm({
      title: `Delete ${n} snapshot${n === 1 ? '' : 's'}?`,
      description:
        (own ? `${own} archived cop${own === 1 ? 'y is' : 'ies are'} removed and the links stop working for everyone, including in show notes. ` : '') +
        (n - own ? `${n - own} archive.today link${n - own === 1 ? ' is' : 's are'} removed from the items and their show notes; the copies on archive.today itself are not affected. ` : '') +
        'This can’t be undone.',
      confirmText: `Delete ${n}`,
      destructive: true,
    });
    if (!ok) return;
    setBatchBusy(true);
    try {
      const { ok: done, failed } = await runBatch(targets, async (item) => {
        const r = await fetch('/api/archive', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id }),
        });
        if (!r.ok) throw new Error('delete failed');
      });
      // Whatever didn't go stays selected, ready to retry.
      setSelected(new Set(failed.map((i) => i.id)));
      if (failed.length) toast.error(`Deleted ${done.length}; ${failed.length} couldn’t be deleted and are still selected`);
      else toast.success(`Deleted ${done.length} snapshot${done.length === 1 ? '' : 's'}`);
    } finally {
      setBatchBusy(false);
      refresh();
    }
  };

  // Rendered above and below the list, so changing page never needs a
  // scroll to the bottom first.
  const showPager = shown.length > ARCHIVE_PAGE_SIZES[0];
  const pager = (where: 'top' | 'bottom') => (
    <nav
      aria-label={`Archive pages (${where})`}
      className={`${where === 'top' ? 'mb-2' : 'mt-3'} flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs`}
    >
      <span className="text-ink/60">
        {paged.from}–{paged.to} of {shown.length}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="xs" onClick={() => goTo(paged.page - 1)} disabled={paged.page <= 1}>
          ‹ Prev
        </Button>
        <span className="text-ink/80">
          Page {paged.page} of {paged.pageCount}
        </span>
        <Button
          variant="outline"
          size="xs"
          onClick={() => goTo(paged.page + 1)}
          disabled={paged.page >= paged.pageCount}
        >
          Next ›
        </Button>
      </div>
      <label className="ml-auto flex items-center gap-2 text-ink/60">
        Per page
        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            goTo(1);
          }}
          className={selectClass}
        >
          {ARCHIVE_PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );

  const recapture = useMutation({
    mutationFn: async (item: ArchiveListItem) => {
      const r = await fetch('/api/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, recapture: true, manual: true }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'Capture failed');
      return body as { archive_url: string | null; refused?: boolean; wayback_requested?: boolean };
    },
    onMutate: (item) => setBusyId(item.id),
    onSuccess: (res) => {
      if (res.refused) toast(refusedMessage(!!res.wayback_requested), { duration: 10000 });
      else if (res.archive_url && !/archive\.(today|ph|is|li|md|fo|vn)\//.test(res.archive_url)) toast.success('Captured');
      else toast.error('Still couldn’t capture this page');
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => {
      setBusyId(null);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: async (item: ArchiveListItem) => {
      const r = await fetch('/api/archive', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
      if (!r.ok) throw new Error('Could not delete the snapshot');
    },
    onMutate: (item) => setBusyId(item.id),
    onSuccess: () => toast.success('Snapshot deleted'),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => {
      setBusyId(null);
      refresh();
    },
  });

  const deleteItem = async (item: ArchiveListItem) => {
    const ok = await confirm({
      title: 'Delete this snapshot?',
      description:
        item.source === 'broadside'
          ? 'The archived copy is removed and its link stops working for everyone, including in show notes.'
          : 'This removes the archive.today link from the item and its show notes. The copy on archive.today itself is not affected.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (ok) remove.mutate(item);
  };

  const copy = async (item: ArchiveListItem) => {
    try {
      await navigator.clipboard.writeText(item.archive_url);
      toast.success('Snapshot link copied');
    } catch {
      toast.error('Could not copy — your browser blocked clipboard access');
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {confirmDialog}
      <AppHeader
        className="border-b-2 border-ink px-6 py-3 gap-6"
        section="archives"
        right={
          <>
            {!isMod && <Link href="/deck" className="underline hover:text-rust">Streamer Deck</Link>}
            {chatEnabled && <Link href="/mod" className="underline hover:text-rust">Mod View</Link>}
            <Link href="/shelf" className="underline hover:text-rust">Shelf</Link>
            {!isMod && <Link href="/setup" className="underline hover:text-rust">Settings</Link>}
            {isAdmin && <Link href="/admin" className="underline hover:text-rust">Admin</Link>}
            <span>{displayName}</span>
          </>
        }
      />

      <main className="px-4 sm:px-6 py-8 max-w-4xl mx-auto w-full flex-1">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-bold mb-2">Archives</h1>
          <p className="text-sm text-ink/60 max-w-xl">
            Every snapshot taken for this channel. Snapshot links are public — anyone with one can
            view it — so delete anything that shouldn&apos;t be shared.
          </p>
        </div>

        <div className="mb-4 flex flex-col gap-3">
          <Input
            type="search"
            value={filters.q}
            onChange={(e) => set('q', e.target.value)}
            placeholder="Search titles, publishers and links…"
            aria-label="Search archives"
            className="w-full"
          />
          <div className="flex flex-wrap items-end gap-3">
            <FilterSelect
              label="Status"
              value={filters.status}
              onChange={(v) => set('status', v as ArchiveFilters['status'])}
              options={[
                ['all', 'All'],
                ['played', 'Played'],
                ['approved', 'On deck'],
                ['pending', 'Pending'],
                ['rejected', 'Rejected'],
              ]}
            />
            <FilterSelect
              label="Source"
              value={filters.source}
              onChange={(v) => set('source', v as ArchiveFilters['source'])}
              options={[
                ['all', 'All'],
                ['broadside', 'Broadside snapshot'],
                ['archive.today', 'archive.today fallback'],
              ]}
            />
            <FilterSelect
              label="Type"
              value={filters.kind}
              onChange={(v) => set('kind', v)}
              options={[['all', 'All'], ...kinds.map((k): [string, string] => [k, KIND_LABELS[k] || k])]}
            />
            <FilterSelect
              label="Sort"
              value={filters.sort}
              onChange={(v) => set('sort', v as ArchiveFilters['sort'])}
              options={[
                ['newest', 'Newest first'],
                ['oldest', 'Oldest first'],
                ['title', 'Title A–Z'],
              ]}
            />
            {filtered && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
          {!isPending && !isError && items.length > 0 && (
            <p className="font-mono text-xs text-ink/60" aria-live="polite">
              {filtered ? `${shown.length} of ${items.length}` : items.length} archived
              {fallbackCount > 0 && ` · ${fallbackCount} on archive.today`}
              {data?.truncated && ' · showing the most recent only'}
            </p>
          )}
        </div>

        {isPending ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
        ) : isError ? (
          <p className="text-center py-16 font-mono text-sm text-rust">Couldn&apos;t load archives. Try reloading.</p>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <p className="font-display text-2xl mb-2">Nothing archived yet.</p>
            <p className="text-ink/60 font-mono text-sm">
              Use the Archive button on an item in the deck or mod view to save a snapshot.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <div className="text-center py-16">
            <p className="font-display text-2xl mb-2">No matches.</p>
            <button type="button" onClick={clearFilters} className="font-mono text-sm underline hover:text-rust">
              Clear filters
            </button>
          </div>
        ) : (
          <div ref={listTop} className="scroll-mt-4">
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs">
              <label className="flex items-center gap-2 text-ink/80">
                <input
                  type="checkbox"
                  checked={pageAllSelected}
                  onChange={togglePage}
                  disabled={batchBusy}
                  aria-label="Select all on this page"
                  className="h-4 w-4 accent-rust"
                />
                Select page
              </label>
              {shown.length > paged.pageItems.length && selectedItems.length < shown.length && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set(shown.map((i) => i.id)))}
                  disabled={batchBusy}
                  className="underline text-ink/70 hover:text-ink"
                >
                  Select all {shown.length}
                  {filtered ? ' matching' : ''}
                </button>
              )}
              {selectedItems.length > 0 && (
                <>
                  <span className="text-ink/60" aria-live="polite">
                    {selectedItems.length} selected
                  </span>
                  <Button variant="outline" size="xs" onClick={() => setSelected(new Set())} disabled={batchBusy}>
                    Clear
                  </Button>
                  <Button variant="destructive" size="xs" onClick={deleteSelected} disabled={batchBusy}>
                    {batchBusy ? 'Deleting…' : `Delete ${selectedItems.length}`}
                  </Button>
                </>
              )}
            </div>
            {showPager && pager('top')}
            <div className="space-y-1.5">
              {paged.pageItems.map((item) => (
                <ArchiveRow
                  key={item.id}
                  item={item}
                  busy={batchBusy || busyId === item.id}
                  selected={selected.has(item.id)}
                  onSelect={(range) => select(item, range)}
                  onCopy={() => copy(item)}
                  onRecapture={() => recapture.mutate(item)}
                  onDelete={() => deleteItem(item)}
                />
              ))}
            </div>
            {showPager && pager('bottom')}
          </div>
        )}

      </main>
    </div>
  );
}
