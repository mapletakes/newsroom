'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
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

export function AdminChannelDetail({ initial, recent }: { initial: ChannelDetail; recent: RecentSubmission[] }) {
  const [ch, setCh] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');

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
            {ch.pending}
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
    </div>
  );
}
