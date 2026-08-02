'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDateTime, relativeTime } from '@/lib/url';

export type ChannelRow = {
  id: string;
  login: string;
  displayName: string | null;
  createdAt: string;
  approved: boolean;
  questionsEnabled: boolean;
  modStatusEnabled: boolean;
  chatEnabled: boolean;
  eventsub: string;
  total: number;
  pending: number;
  lastAt: string | null;
  summaries: number;
  searches: number;
  estCost: number;
};

function eventsubBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    enabled: { label: 'listening', cls: 'text-moss' },
    webhook_callback_verification_pending: { label: 'verifying', cls: 'text-ochre' },
    none: { label: 'none', cls: 'text-ink/40' },
  };
  const m = map[status] || { label: status.replace(/_/g, ' '), cls: 'text-rust' };
  return <span className={`font-mono text-[11px] uppercase tracking-widest whitespace-nowrap ${m.cls}`}>{m.label}</span>;
}

/**
 * A per-channel flag that's both its own status display and the control that
 * flips it — one cell, not a read-only badge in one column plus a same-named
 * button in Actions. That pairing is what was crowding Actions: three flags
 * (access, questions, mod status) each carried a redundant copy of
 * themselves over there, and every new admin-gated feature this session
 * added another pair. Collapsing them here is the actual fix, not just
 * cosmetic — Actions goes back to holding only genuine one-off actions
 * (Re-sub), which is why it no longer needs to wrap.
 */
function ToggleBadge({
  on,
  onLabel,
  offLabel,
  onClick,
  busy,
  title,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  onClick: () => void;
  busy: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title}
      className={cn(
        'font-mono text-[11px] uppercase tracking-widest whitespace-nowrap px-2 py-1 border transition-colors disabled:opacity-40',
        on
          ? 'border-moss/50 text-moss hover:bg-moss hover:text-paper hover:border-moss'
          : 'border-ink/25 text-ink/40 hover:border-ink hover:text-ink',
      )}
    >
      {busy ? '…' : on ? onLabel : offLabel}
    </button>
  );
}

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

  const toggleQuestions = async (row: ChannelRow) => {
    const enabled = !row.questionsEnabled;
    setBusy(row.id + ':questions');
    const r = await fetch('/api/admin/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamId: row.id, enabled }),
    });
    setBusy(null);
    if (r.ok) {
      setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, questionsEnabled: enabled } : x)));
    } else {
      setRowNote(row.id, 'failed');
    }
  };

  const toggleModStatus = async (row: ChannelRow) => {
    const enabled = !row.modStatusEnabled;
    setBusy(row.id + ':modstatus');
    const r = await fetch('/api/admin/mod-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamId: row.id, enabled }),
    });
    setBusy(null);
    if (r.ok) {
      setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, modStatusEnabled: enabled } : x)));
    } else {
      setRowNote(row.id, 'failed');
    }
  };

  const resubscribe = async (row: ChannelRow) => {
    setBusy(row.id + ':sub');
    const r = await fetch('/api/admin/resubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamId: row.id }),
    });
    const data = await r.json().catch(() => ({}));
    setBusy(null);
    if (r.ok && data.ok) {
      setRowNote(row.id, 'subscribed — refresh to confirm');
      setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, eventsub: 'webhook_callback_verification_pending' } : x)));
    } else {
      setRowNote(row.id, data.error ? `failed: ${String(data.error).slice(0, 60)}` : 'failed');
    }
  };

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 flex items-center gap-3 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="border-ink text-[11px]"
          onClick={pruneStale}
          disabled={pruning}
          title="Delete EventSub subscriptions pointing at an old domain (fixes duplicate chat ingestion)"
        >
          {pruning ? 'Pruning…' : 'Prune stale EventSub subs'}
        </Button>
      </div>
      {/* w-full alone caps the table AT the container width, so the browser's
          table layout shrinks columns (and wraps their contents) to fit
          rather than growing past it — which is what was chopping the
          Actions buttons. min-w-max forces the table back to its natural
          content width instead, so once that exceeds the viewport, the
          overflow-x-auto wrapper above scrolls the whole table horizontally
          rather than deforming individual cells. */}
      <table className="w-full min-w-max text-sm border-collapse">
        <thead>
          <tr className="font-mono text-[11px] uppercase tracking-widest text-ink/50 text-left border-b-2 border-ink">
            <th className="py-2 pr-4">Channel</th>
            <th className="py-2 pr-4">Joined</th>
            <th className="py-2 pr-4">Last active</th>
            <th className="py-2 pr-4">Pending</th>
            <th className="py-2 pr-4">Total</th>
            <th className="py-2 pr-4" title="AI enrichment calls · coverage searches">Usage</th>
            <th className="py-2 pr-4">Est. $</th>
            <th className="py-2 pr-4">Chat</th>
            <th className="py-2 pr-4">EventSub</th>
            <th className="py-2 pr-4">Access</th>
            <th className="py-2 pr-4" title="Chat Q&A — the !question-style command">Questions</th>
            <th className="py-2 pr-4" title="Mod availability board (green/yellow/red)">Mod status</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-ink/15 align-middle">
              <td className="py-2 pr-4">
                <div className="font-bold">{row.displayName || row.login}</div>
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
              <td className="py-2 pr-4 font-mono text-ink/60">{row.total}</td>
              <td className="py-2 pr-4 font-mono text-[11px] text-ink/60 whitespace-nowrap" title="AI enrichment calls · coverage searches">
                {row.summaries} <span className="text-ink/30">enr</span> · {row.searches} <span className="text-ink/30">srch</span>
              </td>
              <td className="py-2 pr-4 font-mono text-ink/70 whitespace-nowrap">~${row.estCost.toFixed(2)}</td>
              <td className="py-2 pr-4">
                {row.chatEnabled ? (
                  <span className="font-mono text-[11px] uppercase tracking-widest text-moss whitespace-nowrap">ready</span>
                ) : (
                  <span className="font-mono text-[11px] uppercase tracking-widest text-ink/30 whitespace-nowrap">—</span>
                )}
              </td>
              <td className="py-2 pr-4">{eventsubBadge(row.eventsub)}</td>
              <td className="py-2 pr-4">
                <ToggleBadge
                  on={row.approved}
                  onLabel="Approved"
                  offLabel="Blocked"
                  onClick={() => toggleApproved(row)}
                  busy={busy === row.id + ':access'}
                  title={row.approved ? 'Click to block' : 'Click to approve'}
                />
              </td>
              <td className="py-2 pr-4">
                <ToggleBadge
                  on={row.questionsEnabled}
                  onLabel="On"
                  offLabel="Off"
                  onClick={() => toggleQuestions(row)}
                  busy={busy === row.id + ':questions'}
                  title={
                    (row.questionsEnabled ? 'Click to disable' : 'Click to enable') +
                    ' — chat Q&A (the !question-style command)'
                  }
                />
              </td>
              <td className="py-2 pr-4">
                <ToggleBadge
                  on={row.modStatusEnabled}
                  onLabel="On"
                  offLabel="Off"
                  onClick={() => toggleModStatus(row)}
                  busy={busy === row.id + ':modstatus'}
                  title={
                    (row.modStatusEnabled ? 'Click to disable' : 'Click to enable') +
                    ' — mod availability board'
                  }
                />
              </td>
              <td className="py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="xs"
                    className="text-[11px] whitespace-nowrap"
                    onClick={() => resubscribe(row)}
                    disabled={busy === row.id + ':sub'}
                  >
                    {busy === row.id + ':sub' ? '…' : 'Re-sub'}
                  </Button>
                  {note[row.id] && <span className="font-mono text-[10px] text-ink/60">{note[row.id]}</span>}
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={13} className="py-8 text-center text-ink/50 font-mono text-sm">
                No channels yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
