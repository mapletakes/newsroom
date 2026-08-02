'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { formatDateTime, relativeTime } from '@/lib/url';

export type ChannelRow = {
  id: string;
  login: string;
  displayName: string | null;
  createdAt: string;
  approved: boolean;
  questionsEnabled: boolean;
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
  return <span className={`font-mono text-[11px] uppercase tracking-widest ${m.cls}`}>{m.label}</span>;
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
      <table className="w-full text-sm border-collapse">
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
                  <span className="font-mono text-[11px] uppercase tracking-widest text-moss">ready</span>
                ) : (
                  <span className="font-mono text-[11px] uppercase tracking-widest text-ink/30">—</span>
                )}
              </td>
              <td className="py-2 pr-4">{eventsubBadge(row.eventsub)}</td>
              <td className="py-2 pr-4">
                {row.approved ? (
                  <span className="font-mono text-[11px] uppercase tracking-widest text-moss">approved</span>
                ) : (
                  <span className="font-mono text-[11px] uppercase tracking-widest text-rust">blocked</span>
                )}
              </td>
              <td className="py-2 pr-4">
                {row.questionsEnabled ? (
                  <span className="font-mono text-[11px] uppercase tracking-widest text-moss">on</span>
                ) : (
                  <span className="font-mono text-[11px] uppercase tracking-widest text-ink/30">off</span>
                )}
              </td>
              <td className="py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="xs"
                    className="text-[11px]"
                    onClick={() => toggleApproved(row)}
                    disabled={busy === row.id + ':access'}
                  >
                    {row.approved ? 'Block' : 'Approve'}
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    className="text-[11px]"
                    onClick={() => toggleQuestions(row)}
                    disabled={busy === row.id + ':questions'}
                    title="Chat Q&A — the !question-style command"
                  >
                    {row.questionsEnabled ? 'Disable Q&A' : 'Enable Q&A'}
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    className="text-[11px]"
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
              <td colSpan={12} className="py-8 text-center text-ink/50 font-mono text-sm">
                No channels yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
