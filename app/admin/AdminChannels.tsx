'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateTime, relativeTime } from '@/lib/url';
import { cn } from '@/lib/utils';
import { CHANNEL_MODULES, type ChannelModuleKey } from '@/lib/admin';
import { ToggleBadge, eventsubBadge } from './admin-ui';

export type ChannelRow = {
  id: string;
  login: string;
  displayName: string | null;
  createdAt: string;
  approved: boolean;
  modules: Record<ChannelModuleKey, boolean>;
  chatEnabled: boolean;
  eventsub: string;
  total: number;
  pending: number;
  lastAt: string | null;
  summaries: number;
  searches: number;
  estCost: number;
};

// A channel that's approved but not actually working yet — no chat
// connection, or a chat connection Twitch never confirmed. This is the
// thing an admin opens the dashboard to find: everything else here is just
// context for it.
function needsAttention(row: ChannelRow): boolean {
  return row.approved && (!row.chatEnabled || row.eventsub !== 'enabled');
}

/** Chat + EventSub folded into one badge — a channel with no chat token at
 *  all is a more urgent (and different) problem than one whose subscription
 *  is merely unconfirmed, so it gets its own label rather than reading as
 *  just another EventSub state. */
function healthBadge(row: ChannelRow) {
  if (!row.chatEnabled) {
    return <span className="font-mono text-[11px] uppercase tracking-widest whitespace-nowrap text-rust">no chat</span>;
  }
  return eventsubBadge(row.eventsub);
}

const SORT_OPTIONS = [
  { key: 'joined', label: 'Joined' },
  { key: 'lastActive', label: 'Last active' },
  { key: 'pending', label: 'Pending' },
  { key: 'cost', label: 'Est. $' },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]['key'];

const SORT_COMPARE: Record<SortKey, (a: ChannelRow, b: ChannelRow) => number> = {
  joined: (a, b) => a.createdAt.localeCompare(b.createdAt),
  lastActive: (a, b) => (a.lastAt ?? '').localeCompare(b.lastAt ?? ''),
  pending: (a, b) => a.pending - b.pending,
  cost: (a, b) => a.estCost - b.estCost,
};


export function AdminChannels({ initial }: { initial: ChannelRow[] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [pruning, setPruning] = useState(false);

  const pruneStale = async () => {
    setPruning(true);
    const r = await fetch('/api/admin/eventsub/prune', { method: 'POST' });
    const data = await r.json().catch(() => ({}));
    setPruning(false);
    if (r.ok && data.ok) {
      toast.success(`Deleted ${data.deleted} stale sub(s), kept ${data.kept}.`, {
        description: `Keeping callback: ${data.expectedCallback}`,
      });
    } else {
      toast.error(data.error ? `Failed: ${String(data.error).slice(0, 80)}` : 'Failed');
    }
  };

  const setRowNote = (id: string, msg: string) => {
    setNote((n) => ({ ...n, [id]: msg }));
    setTimeout(() => setNote((n) => ({ ...n, [id]: '' })), 3000);
  };

  const toggleApproved = async (row: ChannelRow) => {
    const approved = !row.approved;
    setBusy(row.id + ':access');
    const r = await fetch('/api/admin/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamId: row.id, approved }),
    });
    setBusy(null);
    if (r.ok) {
      setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, approved } : x)));
    } else {
      setRowNote(row.id, 'failed');
    }
  };

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('joined');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const attentionCount = useMemo(() => rows.filter(needsAttention).length, [rows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = rows;
    if (q) {
      result = result.filter((r) => r.login.toLowerCase().includes(q) || (r.displayName ?? '').toLowerCase().includes(q));
    }
    if (filter === 'attention') {
      result = result.filter(needsAttention);
    }
    const sorted = [...result].sort(SORT_COMPARE[sortKey]);
    if (sortDir === 'desc') sorted.reverse();
    return sorted;
  }, [rows, search, filter, sortKey, sortDir]);

  const setSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search channels…"
          className="w-56 h-8 text-sm"
        />
        <div className="flex items-center gap-1 font-mono text-xs uppercase tracking-widest">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={cn('px-3 py-1 border', filter === 'all' ? 'bg-ink text-paper border-ink' : 'border-ink/30 hover:border-ink')}
          >
            All ({rows.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('attention')}
            title="Approved channels with no chat connection, or an unconfirmed EventSub subscription"
            className={cn(
              'px-3 py-1 border',
              filter === 'attention' ? 'bg-ink text-paper border-ink' : 'border-ink/30 hover:border-ink',
              attentionCount > 0 && filter !== 'attention' && 'border-rust/50 text-rust',
            )}
          >
            Needs attention ({attentionCount})
          </button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-ink text-[11px] ml-auto"
          onClick={pruneStale}
          disabled={pruning}
          title="Delete EventSub subscriptions pointing at an old domain (fixes duplicate chat ingestion)"
        >
          {pruning ? 'Pruning…' : 'Prune stale EventSub subs'}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm border-collapse">
          <thead>
            <tr className="font-mono text-[11px] uppercase tracking-widest text-ink/50 text-left border-b-2 border-ink">
              <th className="py-2 pr-4">Channel</th>
              {SORT_OPTIONS.map((opt) => (
                <th key={opt.key} className="py-2 pr-4">
                  <button type="button" onClick={() => setSort(opt.key)} className="hover:text-ink whitespace-nowrap">
                    {opt.label}
                    {sortKey === opt.key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
                  </button>
                </th>
              ))}
              <th className="py-2 pr-4">Health</th>
              <th className="py-2 pr-4" title={CHANNEL_MODULES.map((m) => m.label).join(' · ')}>Modules</th>
              <th className="py-2">Access</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const modulesOn = CHANNEL_MODULES.filter((m) => row.modules[m.key]);
              return (
                <tr key={row.id} className="border-b border-ink/15 align-middle">
                  <td className="py-2 pr-4">
                    <Link href={`/admin/${row.login}`} className="font-bold hover:underline">
                      {row.displayName || row.login}
                    </Link>
                    <div className="font-mono text-[11px] text-ink/50">#{row.login}</div>
                  </td>
                  <td className="py-2 pr-4 font-mono text-[11px] text-ink/60 whitespace-nowrap">
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td className="py-2 pr-4 font-mono text-[11px] whitespace-nowrap">
                    {row.lastAt ? (
                      <span className="text-ink/70">{relativeTime(row.lastAt)}</span>
                    ) : (
                      <span className="text-ink/30">never</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 font-mono">{row.pending || ''}</td>
                  <td
                    className="py-2 pr-4 font-mono text-ink/70 whitespace-nowrap"
                    title={`${row.total} total · ${row.summaries} enrichment calls · ${row.searches} coverage searches`}
                  >
                    ~${row.estCost.toFixed(2)}
                  </td>
                  <td className="py-2 pr-4">{healthBadge(row)}</td>
                  <td className="py-2 pr-4">
                    {modulesOn.length === 0 ? (
                      <span className="font-mono text-[11px] text-ink/30">—</span>
                    ) : (
                      <span
                        className="font-mono text-[11px] uppercase tracking-widest text-ink/60 whitespace-nowrap"
                        title={modulesOn.map((m) => m.label).join(' · ')}
                      >
                        {modulesOn.length}/{CHANNEL_MODULES.length}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    <ToggleBadge
                      on={row.approved}
                      onLabel="Approved"
                      offLabel="Blocked"
                      onClick={() => toggleApproved(row)}
                      busy={busy === row.id + ':access'}
                      title={row.approved ? 'Click to block' : 'Click to approve'}
                    />
                    {note[row.id] && <span className="ml-2 font-mono text-[10px] text-ink/60">{note[row.id]}</span>}
                  </td>
                </tr>
              );
            })}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={4 + SORT_OPTIONS.length} className="py-8 text-center text-ink/50 font-mono text-sm">
                  {rows.length === 0 ? 'No channels yet.' : 'No channels match.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
