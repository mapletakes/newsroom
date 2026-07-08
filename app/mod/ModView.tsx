'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SubmissionCard, type Submission } from '@/components/SubmissionCard';
import { SwipeRow } from '@/components/SwipeRow';
import { AppHeader } from '@/components/AppHeader';
import { useQueueRealtime } from '@/lib/use-queue-realtime';
import { useVisiblePoll } from '@/lib/use-visible-poll';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Icon } from '@/components/ui/icon';
import { formatDuration, sanitizeShareUrl } from '@/lib/url';

const STATUS_KEYS = ['pending', 'approved', 'played', 'rejected'] as const;
type StatusKey = (typeof STATUS_KEYS)[number];
function isStatusKey(s: string): s is StatusKey {
  return (STATUS_KEYS as readonly string[]).includes(s);
}

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
  // Keyed by submission id, not local to a row's action component: a card
  // stays mounted through its own mutate() call (see below), but keeping
  // this at the ModView level means one place owns "what's true about this
  // row right now" instead of splitting it across the row and its actions.
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'pending' | 'approved' | 'played' | 'rejected'>('pending');
  const [counts, setCounts] = useState<{ pending: number; approved: number; played: number; rejected: number; total: number }>({
    pending: 0,
    approved: 0,
    played: 0,
    rejected: 0,
    total: 0,
  });
  // True once the first fetch resolves — distinguishes "still loading" from
  // "genuinely empty" so the queue doesn't flash a false empty state on load.
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/queue?status=${filter}`);
    if (r.ok) {
      const data = await r.json();
      setSubmissions(data.submissions || []);
      setNowPlaying(data.nowPlaying || null);
      if (data.counts) setCounts(data.counts);
    }
    setLoaded(true);
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
    setRowErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // The card stays put and shows a working state until the write
    // resolves — it used to move out instantly and get put back on
    // failure, but that remove-then-reinsert cycle unmounted/remounted the
    // row for every failed action (e.g. approving a duplicate), which is
    // both a jarring flash and wipes any row-local UI state.
    setPendingIds((prev) => new Set(prev).add(id));

    const r = await fetch('/api/queue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    });

    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      // e.g. trying to approve something already on the deck.
      const message = e.detail || e.error || 'Action failed';
      setRowErrors((prev) => ({ ...prev, [id]: message }));
      return { ok: false, error: message };
    }

    // Now that the write succeeded, move the item out of this tab if its
    // new status no longer belongs here, instead of waiting on refresh().
    const prevItem = submissions.find((s) => s.id === id);
    const newStatus = typeof patch.status === 'string' ? patch.status : null;
    if (prevItem && newStatus && newStatus !== filter && isStatusKey(prevItem.status) && isStatusKey(newStatus)) {
      setSubmissions((prev) => prev.filter((s) => s.id !== id));
      setCounts((c) => ({
        ...c,
        [prevItem.status]: Math.max(0, c[prevItem.status as StatusKey] - 1),
        [newStatus]: c[newStatus as StatusKey] + 1,
      }));
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
      <AppHeader
        className="border-b-2 border-ink px-6 py-3 gap-6"
        section={<>mod triage{isMod && <> · {streamDisplayName}</>}</>}
        right={
          <>
            <span className="uppercase tracking-widest">#{channel}</span>
            <Link href="/choose" className="underline hover:text-rust">Switch Channel</Link>
            {!isMod && <Link href="/deck" className="underline hover:text-rust">Streamer Deck →</Link>}
            {isMod && canCurate && <Link href="/deck" className="underline hover:text-rust">Curate Deck →</Link>}
            {!isMod && <Link href="/setup" className="underline hover:text-rust">Settings</Link>}
            {isAdmin && <Link href="/admin" className="underline hover:text-rust">Admin</Link>}
          </>
        }
      />

      {/* On air — what the streamer is currently showing on the deck */}
      <div className="px-3 sm:px-6 py-2 bg-rust/10 border-b border-rust/30 flex items-center gap-3 flex-wrap min-h-[2.75rem]">
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
                className="hidden sm:block shrink-0 w-12 h-8 object-cover border border-ink/20"
              />
            )}
            {/* A floor on min-width (rather than min-w-0) means the title
                always shows a readable chunk of text instead of collapsing
                to nothing to make room for the trailing buttons — those wrap
                to their own line on narrow screens instead. */}
            <span className="flex-1 min-w-[120px] font-display text-sm font-bold truncate">
              {nowPlaying.title || nowPlaying.url}
            </span>
            <span className="hidden sm:inline shrink-0 font-mono text-[10px] uppercase tracking-widest text-ink/50">
              {nowPlaying.kind.replace('_', ' ')}
              {nowPlaying.duration_seconds ? ` · ${formatDuration(nowPlaying.duration_seconds)}` : ''}
            </span>
            {/* The raw URL + copy are a desktop convenience (pasting into another
                tool while sat at a desk); a mod on a phone just needs Announce/Open. */}
            <input
              readOnly
              value={sanitizeShareUrl(nowPlaying.url)}
              onFocus={(e) => e.currentTarget.select()}
              className="hidden sm:block shrink-0 w-48 font-mono text-[11px] bg-paper border border-ink/20 px-2 py-1 focus:outline-none focus:border-ink"
              aria-label="Now playing URL"
            />
            <span className="hidden sm:inline-flex">
              <CopyButton value={sanitizeShareUrl(nowPlaying.url)} />
            </span>
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
      <div className="px-3 sm:px-6 py-3 border-b border-ink/20 flex items-center gap-1 flex-wrap font-mono text-xs uppercase">
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => { if (v) setFilter(v as 'pending' | 'approved' | 'played' | 'rejected'); }}
        >
          {(['pending', 'approved', 'played', 'rejected'] as const).map((k) => (
            <ToggleGroupItem key={k} value={k} variant="tab">
              {k} ({tabCount(k)})
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {/* Bulk-delete maintenance actions — not the primary phone workflow,
            so they're tucked away below the fold on narrow screens. */}
        <Button variant="outlineDestructive" size="sm" onClick={() => clear('pending')} className="hidden sm:inline-flex">
          Clear pending
        </Button>
        {counts.rejected > 0 && (
          <Button variant="outlineDestructive" size="sm" onClick={() => clear('rejected')} className="hidden sm:inline-flex">
            Clear rejected ({counts.rejected})
          </Button>
        )}
        {counts.played > 0 && (
          <Button variant="outlineDestructive" size="sm" onClick={() => clear('played')} className="hidden sm:inline-flex">
            Clear played ({counts.played})
          </Button>
        )}
        <span className="hidden sm:inline ml-auto text-ink/60">
          {displayName} · {submitCommand ? `command: ${submitCommand}` : 'any URL'}
        </span>
      </div>

      {/* List */}
      <main className="px-3 sm:px-6 py-6 max-w-5xl mx-auto w-full">
        {!loaded ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card-paper p-4 flex gap-4">
                <Skeleton className="w-40 h-24 shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
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
        {filter === 'pending' && submissions.length > 0 && (
          <p className="sm:hidden font-mono text-[10px] uppercase tracking-widest text-ink/40 mb-3 text-center">
            swipe right to approve · swipe left to reject
          </p>
        )}
        <div className="space-y-3">
          {submissions.map((s) => {
            const card = (
            <SubmissionCard
              key={s.id}
              s={s}
              pending={pendingIds.has(s.id)}
              actions={
                <>
                  {rowErrors[s.id] && (
                    <div className="font-mono text-xs text-rust w-full">⚠ {rowErrors[s.id]}</div>
                  )}
                  {s.status === 'pending' && (
                    <ModActions id={s.id} mutate={mutate} pending={pendingIds.has(s.id)} />
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => mutate(s.id, { status: 'pending' })}
                      disabled={pendingIds.has(s.id)}
                    >
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
            );
            // Swipe (touch only) is a mobile shortcut for approve/reject —
            // only meaningful while the card is still pending.
            if (s.status !== 'pending') return card;
            return (
              <SwipeRow
                key={s.id}
                disabled={pendingIds.has(s.id)}
                onApprove={() => mutate(s.id, { status: 'approved' })}
                onReject={() => mutate(s.id, { status: 'rejected' })}
              >
                {card}
              </SwipeRow>
            );
          })}
        </div>
          </>
        )}
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
      <Button
        variant="outline"
        size="xs"
        onClick={post}
        className="text-xs"
        title="Post 'Watching: …' to chat"
        aria-label="Post 'Watching: …' to chat"
      >
        <Icon name="announce" className="text-sm" />
        <span className="hidden sm:inline">Post to chat</span>
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
  pending,
}: {
  id: string;
  mutate: (id: string, patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  pending: boolean;
}) {
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex gap-2 items-center">
        <Button
          variant="moss"
          size="sm"
          className="flex-1 sm:flex-none px-4 py-2.5 text-sm sm:px-3 sm:py-1.5 sm:text-xs"
          onClick={() => mutate(id, { status: 'approved', mod_notes: note || null })}
          disabled={pending}
        >
          {pending ? 'Working…' : 'Approve'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 sm:flex-none px-4 py-2.5 text-sm sm:px-3 sm:py-1.5 sm:text-xs"
          onClick={() => mutate(id, { status: 'rejected' })}
          disabled={pending}
        >
          Reject
        </Button>
      </div>
      <button
        onClick={() => setShowNote(!showNote)}
        className="self-start font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink"
      >
        {showNote ? '− hide note' : '+ add note'}
      </button>
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
