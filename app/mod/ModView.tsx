'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SubmissionCard, type Submission } from '@/components/SubmissionCard';
import { DarkModeToggle } from '@/components/DarkModeToggle';
import { useQueueRealtime } from '@/lib/use-queue-realtime';
import { useVisiblePoll } from '@/lib/use-visible-poll';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Wordmark } from '@/components/ui/wordmark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatDuration, sanitizeShareUrl } from '@/lib/url';

export function ModView({
  channel,
  displayName,
  streamDisplayName,
  submitCommand,
  streamId,
  isMod = false,
  isAdmin = false,
  canCurate = false,
}: {
  channel: string;
  displayName: string;
  streamDisplayName: string;
  submitCommand: string | null;
  streamId: string;
  isMod?: boolean;
  isAdmin?: boolean;
  canCurate?: boolean;
}) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [nowPlaying, setNowPlaying] = useState<Submission | null>(null);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'played' | 'rejected'>('pending');
  const [counts, setCounts] = useState<{ pending: number; approved: number; played: number; rejected: number; total: number }>({
    pending: 0,
    approved: 0,
    played: 0,
    rejected: 0,
    total: 0,
  });

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/queue?status=${filter}`);
    if (r.ok) {
      const data = await r.json();
      setSubmissions(data.submissions || []);
      setNowPlaying(data.nowPlaying || null);
      if (data.counts) setCounts(data.counts);
    }
  }, [filter]);

  useEffect(() => { refresh(); }, [refresh]);

  // Refetch instantly when the server broadcasts a queue change.
  useQueueRealtime(streamId, refresh);

  // Slow fallback poll in case a broadcast is missed or the socket drops.
  // Only ticks while the tab is visible; realtime is the primary path.
  useVisiblePoll(refresh, 120000);

  const mutate = async (
    id: string,
    patch: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string }> => {
    const r = await fetch('/api/queue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      // e.g. trying to approve something already on the deck.
      return { ok: false, error: e.detail || e.error || 'Action failed' };
    }
    // Auto-archive on approval (fire-and-forget; the snapshot link appears
    // on the card once the capture finishes and broadcasts).
    if (patch.status === 'approved') {
      fetch('/api/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }).catch(() => {});
    }
    refresh();
    return { ok: true };
  };

  const tabCount = (k: 'pending' | 'approved' | 'played' | 'rejected') => counts[k];

  const { confirm, confirmDialog } = useConfirm();

  const clear = async (status: 'pending' | 'rejected' | 'played') => {
    const label =
      status === 'pending' ? 'pending submissions' :
      status === 'rejected' ? 'rejected links' :
      'played items';
    const extra = status === 'played'
      ? 'Your exported show notes are kept.'
      : 'Approved deck items are not affected.';
    if (!(await confirm({
      title: `Permanently delete all ${label}?`,
      description: `This can't be undone. ${extra}`,
      confirmText: 'Delete all',
      destructive: true,
    }))) return;
    await fetch('/api/queue/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    refresh();
  };

  return (
    <div className="min-h-screen flex flex-col">
      {confirmDialog}
      {/* Bar */}
      <header className="border-b-2 border-ink px-6 py-3 flex items-center gap-6 flex-wrap">
        <Wordmark />
        <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
          / mod triage{isMod && <> · {streamDisplayName}</>}
        </span>
        <div className="ml-auto flex items-center gap-4 font-mono text-xs">
          <span className="uppercase tracking-widest">#{channel}</span>
          <Link href="/choose" className="underline hover:text-rust">Switch Channel</Link>
          {!isMod && <Link href="/deck" className="underline hover:text-rust">Streamer Deck →</Link>}
          {isMod && canCurate && <Link href="/deck" className="underline hover:text-rust">Curate Deck →</Link>}
          {!isMod && <Link href="/setup" className="underline hover:text-rust">Settings</Link>}
          {isAdmin && <Link href="/admin" className="underline hover:text-rust">Admin</Link>}
          <DarkModeToggle />
        </div>
      </header>

      {/* On air — what the streamer is currently showing on the deck */}
      <div className="px-6 py-2 bg-rust/10 border-b border-rust/30 flex items-center gap-3 flex-wrap min-h-[2.75rem]">
        <span className="shrink-0 font-mono text-xs uppercase tracking-widest text-rust font-bold flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-rust animate-pulse" />
          On air
        </span>
        {nowPlaying ? (
          <>
            {nowPlaying.thumbnail_url && (
              <img
                src={nowPlaying.thumbnail_url}
                alt=""
                className="shrink-0 w-12 h-8 object-cover border border-ink/20"
              />
            )}
            <span className="flex-1 min-w-0 font-display text-sm font-bold truncate">
              {nowPlaying.title || nowPlaying.url}
            </span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-ink/50">
              {nowPlaying.kind.replace('_', ' ')}
              {nowPlaying.duration_seconds ? ` · ${formatDuration(nowPlaying.duration_seconds)}` : ''}
            </span>
            <input
              readOnly
              value={sanitizeShareUrl(nowPlaying.url)}
              onFocus={(e) => e.currentTarget.select()}
              className="shrink-0 w-48 font-mono text-[11px] bg-paper border border-ink/20 px-2 py-1 focus:outline-none focus:border-ink"
              aria-label="Now playing URL"
            />
            <CopyButton value={sanitizeShareUrl(nowPlaying.url)} />
            <AnnounceButton submissionId={nowPlaying.id} />
            <a
              href={nowPlaying.url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 font-mono text-xs uppercase tracking-widest underline hover:text-rust"
            >
              Open ↗
            </a>
          </>
        ) : (
          <span className="font-mono text-xs text-ink/50">Nothing on the deck right now.</span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="px-6 py-3 border-b border-ink/20 flex items-center gap-1 flex-wrap font-mono text-xs uppercase">
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => { if (v) setFilter(v as 'pending' | 'approved' | 'played' | 'rejected'); }}
        >
          {(['pending', 'approved', 'played', 'rejected'] as const).map((k) => (
            <ToggleGroupItem key={k} value={k} className="px-3 py-1.5">
              {k} ({tabCount(k)})
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button variant="outlineDestructive" size="sm" onClick={() => clear('pending')}>
          Clear pending
        </Button>
        {counts.rejected > 0 && (
          <Button variant="outlineDestructive" size="sm" onClick={() => clear('rejected')}>
            Clear rejected ({counts.rejected})
          </Button>
        )}
        {counts.played > 0 && (
          <Button variant="outlineDestructive" size="sm" onClick={() => clear('played')}>
            Clear played ({counts.played})
          </Button>
        )}
        <span className="ml-auto text-ink/60">
          {displayName} · {submitCommand ? `command: ${submitCommand}` : 'any URL'}
        </span>
      </div>

      {/* List */}
      <main className="px-6 py-6 max-w-5xl mx-auto w-full">
        {submissions.length === 0 && (
          <div className="text-center py-24">
            <p className="font-display text-2xl mb-2">
              {filter === 'pending' && 'Waiting for the firehose…'}
              {filter === 'approved' && 'Nothing approved yet.'}
              {filter === 'played' && 'Nothing played yet.'}
              {filter === 'rejected' && 'No rejected links.'}
            </p>
            <p className="text-ink/60 font-mono text-sm">
              {filter === 'pending' && "When chat posts a link, it'll appear here in seconds."}
              {filter === 'approved' && 'Approve pending links to send them to the streamer deck.'}
              {filter === 'played' && 'Items the streamer marks played show up here.'}
              {filter === 'rejected' && 'Rejected links land here — you can unreject any of them.'}
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
                    <Button variant="outline" size="sm" onClick={() => mutate(s.id, { status: 'pending' })}>
                      Unreject
                    </Button>
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

function AnnounceButton({ submissionId }: { submissionId: string }) {
  const [status, setStatus] = useState('');
  const post = async () => {
    if (status === 'Posting…') return;
    setStatus('Posting…');
    try {
      const r = await fetch('/api/deck/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: submissionId }),
      });
      if (r.ok) {
        setStatus('Posted ✓');
      } else {
        const e = await r.json().catch(() => ({}));
        setStatus(e.detail || e.error || 'Failed');
      }
    } catch {
      setStatus('Failed');
    }
    setTimeout(() => setStatus(''), 4000);
  };
  return (
    <span className="shrink-0 flex items-center gap-2">
      <Button variant="outline" size="xs" onClick={post} className="text-xs" title="Post 'Watching: …' to chat">
        <span className="material-icons text-sm">campaign</span>
        Post to chat
      </Button>
      {status && <span className="font-mono text-xs text-ink/60">{status}</span>}
    </span>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="xs"
      className="shrink-0 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? 'Copied!' : 'Copy'}
    </Button>
  );
}

function ModActions({
  id,
  mutate,
}: {
  id: string;
  mutate: (id: string, patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [error, setError] = useState('');
  const [approving, setApproving] = useState(false);

  const approve = async () => {
    setError('');
    setApproving(true);
    const res = await mutate(id, { status: 'approved', mod_notes: note || null });
    setApproving(false);
    if (!res.ok) setError(res.error || 'Could not approve');
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex gap-2 flex-wrap items-center">
        <Button variant="moss" size="sm" onClick={approve} disabled={approving}>
          {approving ? 'Approving…' : 'Approve'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => mutate(id, { status: 'rejected' })}>
          Reject
        </Button>
        <button
          onClick={() => setShowNote(!showNote)}
          className="font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink"
        >
          {showNote ? '− hide note' : '+ add note'}
        </button>
      </div>
      {error && (
        <div className="font-mono text-xs text-rust">⚠ {error}</div>
      )}
      {showNote && (
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. skip to 4:32, check the replies, paywalled..."
          className="w-full text-xs"
        />
      )}
    </div>
  );
}
