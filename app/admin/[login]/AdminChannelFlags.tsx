'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FLAG_CATEGORIES, MAX_REMOVAL_REASON, type AdminFlag } from '@/lib/chatter-flag-types';
import { formatLogTime, localDayKey } from '@/lib/suspicious-log-query';
import { relativeTime } from '@/lib/url';

const STATUS_CLASS: Record<AdminFlag['status'], string> = {
  active: 'text-moss',
  withdrawn: 'text-ink/50',
  expired: 'text-ink/50',
  removed: 'text-rust',
};

function AdminFlagRow({ flag, onChanged }: { flag: AdminFlag; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const act = async (action: 'remove' | 'restore') => {
    setBusy(true);
    setError('');
    const r = await fetch('/api/admin/chatter-flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: flag.id, action, reason }),
    });
    const data = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setError(typeof data.error === 'string' ? data.error : 'failed');
      return;
    }
    setRemoving(false);
    setReason('');
    onChanged();
  };

  return (
    <li className="border-b border-ink/10 py-2 font-mono text-[11px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="font-bold text-ink hover:text-rust">
          {flag.chatter_name}
        </button>
        <span>{FLAG_CATEGORIES[flag.category]}</span>
        <span className="text-ink/50">by {flag.created_by_login}</span>
        <span className="text-ink/50">{relativeTime(flag.created_at)}</span>
        <span className="text-ink/50">{flag.messages.length} msg</span>
        <span className={`uppercase tracking-widest ${STATUS_CLASS[flag.status]}`}>{flag.status}</span>
        <span className="ml-auto">
          {flag.status === 'active' && !removing && (
            <Button variant="outlineDestructive" size="xs" onClick={() => setRemoving(true)}>
              Remove
            </Button>
          )}
          {flag.status === 'removed' && (
            <Button variant="outline" size="xs" onClick={() => act('restore')} disabled={busy}>
              Restore
            </Button>
          )}
        </span>
      </div>
      {flag.status === 'removed' && (
        <p className="mt-1 text-rust">
          Removed{flag.removed_by_login ? ` by ${flag.removed_by_login}` : ''}: {flag.removed_reason}
        </p>
      )}
      {removing && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) act('remove');
          }}
        >
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MAX_REMOVAL_REASON}
            placeholder="Reason, shown to the channel that made it"
            aria-label="Reason for removing"
            className="h-7 min-w-[16rem] flex-1 border border-ink/30 bg-paper px-2 focus:border-ink focus:outline-none"
            autoFocus
          />
          <Button type="submit" variant="destructive" size="xs" disabled={busy || !reason.trim()}>
            {busy ? 'Removing…' : 'Remove flag'}
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={() => setRemoving(false)}>
            Cancel
          </Button>
        </form>
      )}
      {error && <p className="mt-1 text-rust">{error}</p>}
      {open && (
        <div className="mt-2 grid gap-2 pl-2 text-ink/80">
          {flag.context && <p className="whitespace-pre-wrap break-words">{flag.context}</p>}
          {flag.messages.length > 0 && (
            <ul>
              {flag.messages.map((m) => (
                <li key={m.id} className="flex gap-2">
                  <span className="shrink-0 tabular-nums text-ink/50">
                    {localDayKey(m.sent_at)} {formatLogTime(m.sent_at)}
                  </span>
                  <span className="min-w-0 whitespace-pre-wrap break-words">{m.message_text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/** The chatter flags a channel has made, with the means to take one down. */
export function AdminChannelFlags({ streamId }: { streamId: string }) {
  const [flags, setFlags] = useState<AdminFlag[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/chatter-flags?streamId=${streamId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { flags: AdminFlag[] }) => live && setFlags(data.flags))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [streamId, version]);

  return (
    <div className="mt-8">
      <h2 className="font-mono text-xs uppercase tracking-widest text-ink/50 mb-2">Chatter flags</h2>
      {failed ? (
        <p className="font-mono text-sm text-rust">Couldn&apos;t load flags.</p>
      ) : flags === null ? (
        <p className="font-mono text-sm text-ink/40">Loading…</p>
      ) : flags.length === 0 ? (
        <p className="font-mono text-sm text-ink/40">This channel hasn&apos;t flagged anyone.</p>
      ) : (
        <ul>
          {flags.map((flag) => (
            <AdminFlagRow key={flag.id} flag={flag} onChanged={() => setVersion((v) => v + 1)} />
          ))}
        </ul>
      )}
    </div>
  );
}
