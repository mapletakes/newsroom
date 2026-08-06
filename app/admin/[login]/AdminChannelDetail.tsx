'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatDateTime, relativeTime } from '@/lib/url';
import { CHANNEL_MODULES, type ChannelModuleKey } from '@/lib/admin';
import { ToggleBadge, eventsubBadge } from '../admin-ui';

export type ChannelDetail = {
  id: string;
  login: string;
  displayName: string | null;
  createdAt: string;
  approved: boolean;
  chatEnabled: boolean;
  modules: Record<ChannelModuleKey, boolean>;
  eventsub: string;
  total: number;
  pending: number;
  lastAt: string | null;
  summaries: number;
  searches: number;
  estCost: number;
};

export type RecentSubmission = {
  id: string;
  url: string;
  title: string | null;
  status: string;
  created_at: string;
};

export type ActivityEntry = {
  id: string;
  actorLogin: string;
  action: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

function describeActivity(entry: ActivityEntry): string {
  const p = entry.payload ?? {};
  switch (entry.action) {
    case 'flag': {
      const label = CHANNEL_MODULES.find((m) => m.key === p.flag)?.label ?? String(p.flag);
      return `turned ${label} ${p.enabled ? 'on' : 'off'}`;
    }
    case 'access':
      return p.approved ? 'approved this channel' : 'blocked this channel';
    case 'resubscribe':
      return 're-subscribed to chat events';
    case 'clear_pending':
      return `cleared ${p.count} pending item${p.count === 1 ? '' : 's'}`;
    default:
      return entry.action;
  }
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending: 'text-ochre',
    approved: 'text-moss',
    played: 'text-ink/50',
    rejected: 'text-rust',
  };
  return (
    <span className={`font-mono text-[11px] uppercase tracking-widest whitespace-nowrap ${map[status] || 'text-ink/40'}`}>
      {status}
    </span>
  );
}

export function AdminChannelDetail({
  initial,
  recent,
  activity,
}: {
  initial: ChannelDetail;
  recent: RecentSubmission[];
  activity: ActivityEntry[];
}) {
  const [ch, setCh] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const { confirm, confirmDialog } = useConfirm();

  const setTempNote = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(''), 3000);
  };

  const toggleApproved = async () => {
    const approved = !ch.approved;
    setBusy('access');
    const r = await fetch('/api/admin/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamId: ch.id, approved }),
    });
    setBusy(null);
    if (r.ok) setCh((c) => ({ ...c, approved }));
    else setTempNote('failed');
  };

  const toggleModule = async (flag: ChannelModuleKey) => {
    const enabled = !ch.modules[flag];
    setBusy(flag);
    const r = await fetch('/api/admin/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamId: ch.id, flag, enabled }),
    });
    setBusy(null);
    if (r.ok) setCh((c) => ({ ...c, modules: { ...c.modules, [flag]: enabled } }));
    else setTempNote('failed');
  };

  const resubscribe = async () => {
    setBusy('sub');
    const r = await fetch('/api/admin/resubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamId: ch.id }),
    });
    const data = await r.json().catch(() => ({}));
    setBusy(null);
    if (r.ok && data.ok) {
      setTempNote('subscribed — refresh to confirm');
      setCh((c) => ({ ...c, eventsub: 'webhook_callback_verification_pending' }));
    } else {
      setTempNote(data.error ? `failed: ${String(data.error).slice(0, 60)}` : 'failed');
    }
  };

  const clearPending = async () => {
    const count = ch.pending;
    if (count === 0) return;
    if (
      !(await confirm({
        title: `Reject all ${count} pending item${count === 1 ? '' : 's'} for ${ch.displayName || ch.login}?`,
        description: 'Marks them rejected — nothing is deleted, and this can be undone item by item on the deck.',
        confirmText: 'Clear pending',
        destructive: true,
      }))
    ) {
      return;
    }
    setBusy('clear-pending');
    const r = await fetch('/api/admin/clear-pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamId: ch.id }),
    });
    const data = await r.json().catch(() => ({}));
    setBusy(null);
    if (r.ok && data.ok) {
      setTempNote(`cleared ${data.count} pending item${data.count === 1 ? '' : 's'}`);
      setCh((c) => ({ ...c, pending: 0 }));
    } else {
      setTempNote(data.error ? `failed: ${String(data.error).slice(0, 60)}` : 'failed');
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-4xl font-bold mb-1">{ch.displayName || ch.login}</h1>
        <div className="font-mono text-xs text-ink/50">
          #{ch.login} · joined {formatDateTime(ch.createdAt)}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ToggleBadge
          on={ch.approved}
          onLabel="Approved"
          offLabel="Blocked"
          onClick={toggleApproved}
          busy={busy === 'access'}
          title={ch.approved ? 'Click to block' : 'Click to approve'}
        />
        <span className="font-mono text-[11px] text-ink/40">·</span>
        {ch.chatEnabled ? (
          <span className="font-mono text-[11px] uppercase tracking-widest text-moss">chat ready</span>
        ) : (
          <span className="font-mono text-[11px] uppercase tracking-widest text-ink/30">chat not connected</span>
        )}
        <span className="font-mono text-[11px] text-ink/40">·</span>
        {eventsubBadge(ch.eventsub)}
        <Button variant="outline" size="xs" className="text-[11px]" onClick={resubscribe} disabled={busy === 'sub'}>
          {busy === 'sub' ? '…' : 'Re-sub'}
        </Button>
        {note && <span className="font-mono text-[11px] text-ink/60">{note}</span>}
      </div>

      <div>
        <h2 className="font-mono text-xs uppercase tracking-widest text-ink/50 mb-2">Modules</h2>
        <div className="flex flex-wrap gap-3">
          {CHANNEL_MODULES.map((m) => (
            <div key={m.key} className="border border-ink/15 px-3 py-2 flex items-center gap-3">
              <div>
                <div className="text-sm font-bold">{m.label}</div>
                <div className="text-[11px] text-ink/50 max-w-[16rem]">{m.blurb}</div>
              </div>
              <ToggleBadge
                on={ch.modules[m.key]}
                onLabel="On"
                offLabel="Off"
                onClick={() => toggleModule(m.key)}
                busy={busy === m.key}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="font-mono text-xs uppercase tracking-widest text-ink/50 mb-2">Usage</h2>
        <div className="flex flex-wrap gap-6 font-mono text-sm">
          <div>
            <span className="text-ink/50 text-[11px] block uppercase tracking-widest">Total</span>
            {ch.total}
          </div>
          <div>
            <span className="text-ink/50 text-[11px] block uppercase tracking-widest">Pending</span>
            <span className="inline-flex items-center gap-2">
              {ch.pending}
              {ch.pending > 0 && (
                <Button
                  variant="outline"
                  size="xs"
                  className="text-[11px] font-mono normal-case"
                  onClick={clearPending}
                  disabled={busy === 'clear-pending'}
                >
                  {busy === 'clear-pending' ? '…' : 'Clear'}
                </Button>
              )}
            </span>
          </div>
          <div>
            <span className="text-ink/50 text-[11px] block uppercase tracking-widest">Last active</span>
            {ch.lastAt ? relativeTime(ch.lastAt) : 'never'}
          </div>
          <div>
            <span className="text-ink/50 text-[11px] block uppercase tracking-widest">Enrichment / searches</span>
            {ch.summaries} enr · {ch.searches} srch
          </div>
          <div>
            <span className="text-ink/50 text-[11px] block uppercase tracking-widest">Est. cost</span>~${ch.estCost.toFixed(2)}
          </div>
        </div>
      </div>

      <div>
        <h2 className="font-mono text-xs uppercase tracking-widest text-ink/50 mb-2">Recent submissions</h2>
        {recent.length === 0 ? (
          <p className="font-mono text-sm text-ink/40">None yet.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <tbody>
              {recent.map((s) => (
                <tr key={s.id} className="border-b border-ink/10">
                  <td className="py-1.5 pr-3 font-mono text-[11px] text-ink/50 whitespace-nowrap">
                    {relativeTime(s.created_at)}
                  </td>
                  <td className="py-1.5 pr-3">{s.title || s.url}</td>
                  <td className="py-1.5">{statusBadge(s.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h2 className="font-mono text-xs uppercase tracking-widest text-ink/50 mb-2">Recent activity</h2>
        {activity.length === 0 ? (
          <p className="font-mono text-sm text-ink/40">No admin actions on this channel yet.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <tbody>
              {activity.map((a) => (
                <tr key={a.id} className="border-b border-ink/10">
                  <td className="py-1.5 pr-3 font-mono text-[11px] text-ink/50 whitespace-nowrap">
                    {relativeTime(a.createdAt)}
                  </td>
                  <td className="py-1.5 font-mono text-[11px] text-ink/70">
                    <span className="font-bold text-ink">#{a.actorLogin}</span> {describeActivity(a)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
