'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SubmissionCard, type Submission } from '@/components/SubmissionCard';
import { DarkModeToggle } from '@/components/DarkModeToggle';
import { useQueueRealtime } from '@/lib/use-queue-realtime';

export function ModView({
  channel,
  displayName,
  streamDisplayName,
  submitCommand,
  streamId,
  isMod = false,
}: {
  channel: string;
  displayName: string;
  streamDisplayName: string;
  submitCommand: string | null;
  streamId: string;
  isMod?: boolean;
}) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'played' | 'all'>('pending');
  const [counts, setCounts] = useState<{ pending: number; approved: number; played: number; rejected: number; total: number }>({
    pending: 0,
    approved: 0,
    played: 0,
    rejected: 0,
    total: 0,
  });

  const refresh = useCallback(async () => {
    const url = filter === 'all' ? '/api/queue' : `/api/queue?status=${filter}`;
    const r = await fetch(url);
    if (r.ok) {
      const data = await r.json();
      setSubmissions(data.submissions || []);
      if (data.counts) setCounts(data.counts);
    }
  }, [filter]);

  useEffect(() => { refresh(); }, [refresh]);

  // Refetch instantly when the server broadcasts a queue change.
  useQueueRealtime(streamId, refresh);

  // Slow fallback poll in case a broadcast is missed or the socket drops.
  useEffect(() => {
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  const mutate = async (id: string, patch: Record<string, unknown>) => {
    await fetch('/api/queue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    });
    refresh();
  };

  const tabCount = (k: 'pending' | 'approved' | 'played' | 'all') =>
    k === 'all' ? counts.total : counts[k];

  const clear = async (status: 'pending' | 'rejected' | 'played') => {
    const label =
      status === 'pending' ? 'pending submissions' :
      status === 'rejected' ? 'rejected links' :
      'played items';
    const extra = status === 'played'
      ? ' Your exported show notes are kept.'
      : ' Approved deck items are not affected.';
    if (!window.confirm(`Permanently delete all ${label}? This can't be undone.${extra}`)) return;
    await fetch('/api/queue/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    refresh();
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Bar */}
      <header className="border-b-2 border-ink px-6 py-3 flex items-center gap-6 flex-wrap">
        <Link href="/" className="font-display text-2xl font-black">Newsroom</Link>
        <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
          / mod triage{isMod && <> · {streamDisplayName}</>}
        </span>
        <div className="ml-auto flex items-center gap-4 font-mono text-xs">
          <span className="uppercase tracking-widest">#{channel}</span>
          <Link href="/choose" className="underline hover:text-rust">Switch Channel</Link>
          {!isMod && <Link href="/deck" className="underline hover:text-rust">Streamer Deck →</Link>}
          {!isMod && <Link href="/setup" className="underline hover:text-rust">Settings</Link>}
          <DarkModeToggle />
        </div>
      </header>

      {/* Filter tabs */}
      <div className="px-6 py-3 border-b border-ink/20 flex items-center gap-1 flex-wrap font-mono text-xs uppercase">
        {(['pending', 'approved', 'played', 'all'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-3 py-1.5 tracking-widest border ${
              filter === k ? 'bg-ink text-paper border-ink' : 'border-ink/30 hover:border-ink'
            }`}
          >
            {k} ({tabCount(k)})
          </button>
        ))}
        <button
          onClick={() => clear('pending')}
          className="px-3 py-1.5 tracking-widest border border-rust/50 text-rust hover:bg-rust hover:text-paper transition-colors"
        >
          Clear pending
        </button>
        {counts.rejected > 0 && (
          <button
            onClick={() => clear('rejected')}
            className="px-3 py-1.5 tracking-widest border border-rust/50 text-rust hover:bg-rust hover:text-paper transition-colors"
          >
            Clear rejected ({counts.rejected})
          </button>
        )}
        {counts.played > 0 && (
          <button
            onClick={() => clear('played')}
            className="px-3 py-1.5 tracking-widest border border-rust/50 text-rust hover:bg-rust hover:text-paper transition-colors"
          >
            Clear played ({counts.played})
          </button>
        )}
        <span className="ml-auto text-ink/60">
          {displayName} · {submitCommand ? `command: ${submitCommand}` : 'any URL'}
        </span>
      </div>

      {/* List */}
      <main className="px-6 py-6 max-w-5xl mx-auto w-full">
        {submissions.length === 0 && (
          <div className="text-center py-24">
            <p className="font-display text-2xl mb-2">Waiting for the firehose…</p>
            <p className="text-ink/60 font-mono text-sm">
              When chat posts a link, it&apos;ll appear here in seconds.
            </p>
          </div>
        )}
        <div className="space-y-3">
          {submissions.map((s) => (
            <SubmissionCard
              key={s.id}
              s={s}
              actions={
                <>
                  {s.status === 'pending' && (
                    <ModActions id={s.id} mutate={mutate} />
                  )}
                  {s.status === 'approved' && (
                    <div className="flex flex-col gap-1 w-full">
                      <span className="font-mono text-xs uppercase tracking-widest text-moss">
                        ✓ approved · waiting for streamer
                      </span>
                      {s.mod_notes && (
                        <span className="font-mono text-xs text-ink/60">
                          Note: {s.mod_notes}
                        </span>
                      )}
                    </div>
                  )}
                  {s.status === 'rejected' && (
                    <button
                      onClick={() => mutate(s.id, { status: 'pending' })}
                      className="font-mono text-xs uppercase tracking-widest border border-ink/40 px-3 py-1.5 hover:bg-ink hover:text-paper"
                    >
                      Unreject
                    </button>
                  )}
                  {s.status === 'played' && (
                    <span className="font-mono text-xs uppercase tracking-widest text-ink/50">
                      ▶ played on air
                    </span>
                  )}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs uppercase tracking-widest underline ml-auto"
                  >
                    Open ↗
                  </a>
                </>
              }
            />
          ))}
        </div>
      </main>
    </div>
  );
}

function ModActions({
  id,
  mutate,
}: {
  id: string;
  mutate: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex gap-2 flex-wrap items-center">
        <button
          onClick={() => mutate(id, { status: 'approved', mod_notes: note || null })}
          className="font-mono text-xs uppercase tracking-widest bg-moss text-paper px-3 py-1.5 hover:opacity-90"
        >
          Approve
        </button>
        <button
          onClick={() => mutate(id, { status: 'rejected' })}
          className="font-mono text-xs uppercase tracking-widest border border-ink/40 px-3 py-1.5 hover:bg-ink hover:text-paper"
        >
          Reject
        </button>
        <button
          onClick={() => setShowNote(!showNote)}
          className="font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink"
        >
          {showNote ? '− hide note' : '+ add note'}
        </button>
      </div>
      {showNote && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. skip to 4:32, check the replies, paywalled..."
          className="w-full border border-ink/30 bg-paper px-2 py-1.5 font-mono text-xs focus:outline-none focus:border-ink"
        />
      )}
    </div>
  );
}
