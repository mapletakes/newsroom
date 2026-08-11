'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SubmissionCard, type Submission } from '@/components/SubmissionCard';
import { SwipeRow } from '@/components/SwipeRow';
import { SaveToListMenu } from '@/components/SaveToListMenu';
import { TriggerWarningEditor } from '@/components/TriggerWarning';
import { AppHeader } from '@/components/AppHeader';
import { QuestionsPanel } from '@/components/QuestionsPanel';
import { ModStatusPanel } from '@/components/ModStatusPanel';
import { RafflePanel } from '@/components/RafflePanel';
import { DeckRail } from '@/components/DeckRail';
import { ModShortcutsModal } from './ModShortcutsModal';
import { useElementHeight } from '@/lib/use-element-height';
import { useInvalidateOnChange } from '@/lib/use-invalidate-on-change';
import { queryKeys } from '@/lib/query-keys';
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

type Counts = { pending: number; approved: number; played: number; rejected: number; total: number };
type QueueData = { submissions: Submission[]; nowPlaying: Submission | null; counts: Counts };

const EMPTY_COUNTS: Counts = { pending: 0, approved: 0, played: 0, rejected: 0, total: 0 };

async function fetchQueue(filter: string): Promise<QueueData> {
  const r = await fetch(`/api/queue?status=${filter}`);
  if (!r.ok) throw new Error('Failed to load queue');
  const data = await r.json();
  return {
    submissions: data.submissions || [],
    nowPlaying: data.nowPlaying || null,
    counts: data.counts || EMPTY_COUNTS,
  };
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
  questionsEnabled = false,
  questionsOpen = true,
  modStatusEnabled = false,
  raffleEnabled = false,
}: {
  channel: string;
  displayName: string;
  streamDisplayName: string;
  submitCommand: string | null;
  streamId: string;
  isMod?: boolean;
  isAdmin?: boolean;
  canCurate?: boolean;
  questionsEnabled?: boolean;
  questionsOpen?: boolean;
  modStatusEnabled?: boolean;
  raffleEnabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const headerRef = useRef<HTMLElement>(null);
  const headerHeight = useElementHeight(headerRef);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'played' | 'rejected'>('pending');
  const queueKey = queryKeys.queue(streamId, filter);
  const queueKeyAllFilters = queryKeys.queue(streamId); // prefix — matches every filter's cached query

  // keepPreviousData means switching tabs keeps showing the last filter's
  // list while the new one loads, instead of flashing back to the skeleton —
  // matches the original's behavior of never resetting `loaded` after the
  // first fetch. refetchInterval replaces the old useVisiblePoll(120s)
  // backstop (it already pauses in background tabs by default).
  const { data, isPending: loading } = useQuery({
    queryKey: queueKey,
    queryFn: () => fetchQueue(filter),
    placeholderData: keepPreviousData,
    refetchInterval: 120000,
  });
  const submissions = data?.submissions ?? [];
  const nowPlaying = data?.nowPlaying ?? null;
  const counts = data?.counts ?? EMPTY_COUNTS;
  const loaded = !loading;

  // Refetch instantly when the server broadcasts a queue change — invalidate
  // every filter's cached query (not just the one currently on screen) so
  // switching tabs later shows fresh data instead of a stale cache.
  useInvalidateOnChange(streamId, queueKeyAllFilters);

  // Keyed by submission id, not local to a row's action component: a card
  // stays mounted through its own mutate() call (see below), but keeping
  // this at the ModView level means one place owns "what's true about this
  // row right now" instead of splitting it across the row and its actions.
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const statusMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const r = await fetch('/api/queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.detail || e.error || 'Action failed');
      }
      return r.json();
    },
  });

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

    let result: { ok: boolean; error?: string };
    try {
      await statusMutation.mutateAsync({ id, patch });
      result = { ok: true };
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : 'Action failed' };
    }

    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    if (!result.ok) {
      setRowErrors((prev) => ({ ...prev, [id]: result.error! }));
      return result;
    }

    // Now that the write succeeded, move the item out of this tab if its
    // new status no longer belongs here, instead of waiting on a refetch.
    const prevItem = submissions.find((s) => s.id === id);
    const newStatus = typeof patch.status === 'string' ? patch.status : null;
    if (prevItem && newStatus && newStatus !== filter && isStatusKey(prevItem.status) && isStatusKey(newStatus)) {
      queryClient.setQueryData<QueueData>(queueKey, (prev) => {
        if (!prev) return prev;
        const fromStatus = prevItem.status as StatusKey;
        const toStatus = newStatus as StatusKey;
        return {
          ...prev,
          submissions: prev.submissions.filter((s) => s.id !== id),
          counts: {
            ...prev.counts,
            [fromStatus]: Math.max(0, prev.counts[fromStatus] - 1),
            [toStatus]: prev.counts[toStatus] + 1,
          },
        };
      });
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
    queryClient.invalidateQueries({ queryKey: queueKeyAllFilters });
    return { ok: true };
  };

  // Approve/reject are the two actions a triage mod fires off fastest — a
  // swipe, a keypress, a misclick on a busy queue — so both get an Undo
  // toast. Unlike the deck's version (which delays the real write behind a
  // timer so it can silently cancel), this fires the write immediately: mod
  // triage is shared and realtime-synced across everyone working the queue,
  // so pretending an action didn't happen yet would let two mods act on the
  // same item based on stale state. Undo here is a second, equally real
  // write back to pending, not a cancellation.
  const approveItem = async (id: string, note: string) => {
    const result = await mutate(id, { status: 'approved', mod_notes: note || null });
    if (result.ok) {
      toast('Approved', {
        duration: 5000,
        action: { label: 'Undo', onClick: () => mutate(id, { status: 'pending' }) },
      });
    }
    return result;
  };

  const rejectItem = async (id: string) => {
    const result = await mutate(id, { status: 'rejected' });
    if (result.ok) {
      toast('Rejected', {
        duration: 5000,
        action: { label: 'Undo', onClick: () => mutate(id, { status: 'pending' }) },
      });
    }
    return result;
  };

  const tabCount = (k: 'pending' | 'approved' | 'played' | 'rejected') => counts[k];

  const { confirm, confirmDialog } = useConfirm();

  const clearMutation = useMutation({
    mutationFn: async (status: 'pending' | 'rejected' | 'played') => {
      await fetch('/api/queue/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queueKeyAllFilters }),
  });

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
    clearMutation.mutate(status);
  };

  // Keeps the keyboard-nav highlight in range as the pending list shrinks
  // (an approve/reject removes the focused item, shifting the next one into
  // its place) and resets it whenever the visible tab changes.
  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, Math.max(0, submissions.length - 1)));
  }, [submissions.length]);
  useEffect(() => {
    setFocusedIndex(0);
  }, [filter]);

  // Held in a ref so the single listener always sees the latest state —
  // same pattern as the deck's keyboard handler (app/deck/DeckView.tsx).
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    // Don't hijack typing in inputs / textareas / contenteditable fields
    // (e.g. the per-item note).
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;

    if (e.key === '?') {
      e.preventDefault();
      setShortcutsOpen(true);
      return;
    }

    // Navigate/approve/reject only mean something on the pending tab —
    // that's the only tab these shortcuts' target buttons render on.
    if (filter !== 'pending' || submissions.length === 0) return;

    const target = submissions[focusedIndex];
    if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, submissions.length - 1));
    } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if ((e.key === 'a' || e.key === 'A') && target && !pendingIds.has(target.id)) {
      e.preventDefault();
      approveItem(target.id, '');
    } else if ((e.key === 'r' || e.key === 'R') && target && !pendingIds.has(target.id)) {
      e.preventDefault();
      rejectItem(target.id);
    } else if (e.key === 'Enter' && target) {
      e.preventDefault();
      window.open(target.url, '_blank', 'noopener,noreferrer');
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {confirmDialog}
      <ModShortcutsModal open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {/* Same rail, same module order, as the deck (app/deck/DeckView.tsx) —
          a mod who learns where a module lives on one screen shouldn't have
          to relearn it as a header link on the other. Quick links has no
          entry here: it's the streamer's own go-live reference, not
          triage-relevant. */}
      {(questionsEnabled || modStatusEnabled || raffleEnabled) && (
        <DeckRail headerHeight={headerHeight}>
          {questionsEnabled && (
            <QuestionsPanel
              streamId={streamId}
              enabled={questionsEnabled}
              open={questionsOpen}
              variant="tab"
              canSetNowPlaying={canCurate}
            />
          )}
          {modStatusEnabled && <ModStatusPanel streamId={streamId} enabled={modStatusEnabled} variant="tab" />}
          {raffleEnabled && <RafflePanel streamId={streamId} enabled={raffleEnabled} variant="tab" />}
        </DeckRail>
      )}
      {/* Bar */}
      <AppHeader
        ref={headerRef}
        className="border-b-2 border-ink pl-10 pr-6 py-3 gap-6"
        section={<>mod triage{isMod && <> · {streamDisplayName}</>}</>}
        right={
          <>
            <span className="uppercase tracking-widest">#{channel}</span>
            <Link href="/choose" className="underline hover:text-rust">Switch Channel</Link>
            {!isMod && <Link href="/deck" className="underline hover:text-rust">Streamer Deck →</Link>}
            {isMod && canCurate && <Link href="/deck" className="underline hover:text-rust">Curate Deck →</Link>}
            <Link href="/shelf" className="underline hover:text-rust">Shelf</Link>
            {/* Questions and Mod status are reached via the rail above, not a
                header link — see the DeckRail block's comment. */}
            {/* Two different pages, deliberately: /setup is the channel and is
                the streamer's, /preferences is just how this person wants the
                app to look. */}
            {!isMod && <Link href="/setup" className="underline hover:text-rust">Settings</Link>}
            {isMod && <Link href="/preferences" className="underline hover:text-rust">Preferences</Link>}
            {isAdmin && <Link href="/admin" className="underline hover:text-rust">Admin</Link>}
          </>
        }
      />

      {/* On air — what the streamer is currently showing on the deck */}
      <div className="pl-10 pr-3 sm:pr-6 py-2 bg-rust/10 border-b border-rust/30 flex items-center gap-3 flex-wrap min-h-[2.75rem]">
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
            {nowPlaying.trigger_warning && (
              <span className="shrink-0 max-w-full font-mono text-[10px] uppercase tracking-widest bg-rust text-paper px-2 py-1">
                ⚠ TW: {nowPlaying.trigger_warning}
              </span>
            )}
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
      <div className="pl-10 pr-3 sm:pr-6 py-3 border-b border-ink/20 flex items-center gap-1 flex-wrap font-mono text-xs uppercase">
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
          {filter === 'pending' && submissions.length > 0 && (
            <>
              {' '}·{' '}
              <button
                type="button"
                onClick={() => setShortcutsOpen(true)}
                className="underline hover:text-rust"
              >
                ? for shortcuts
              </button>
            </>
          )}
        </span>
      </div>

      {/* List */}
      <main className="pl-10 pr-3 sm:pr-6 py-6 max-w-5xl mx-auto w-full">
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
          {submissions.map((s, idx) => {
            const card = (
            <SubmissionCard
              key={s.id}
              s={s}
              pending={pendingIds.has(s.id)}
              focused={filter === 'pending' && idx === focusedIndex}
              actions={
                <>
                  {rowErrors[s.id] && (
                    <div className="font-mono text-xs text-rust w-full">⚠ {rowErrors[s.id]}</div>
                  )}
                  {s.status === 'pending' && (
                    <ModActions id={s.id} onApprove={approveItem} onReject={rejectItem} pending={pendingIds.has(s.id)} />
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
                  {/* Available on approved items too, not just during triage —
                      the need for a warning often only becomes obvious once
                      someone actually watches the thing, which is usually
                      after it's been waved through. */}
                  {(s.status === 'pending' || s.status === 'approved') && (
                    <div className="w-full">
                      <TriggerWarningEditor
                        key={s.id}
                        value={s.trigger_warning}
                        onSave={(v) => mutate(s.id, { trigger_warning: v })}
                      />
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
                  {canCurate && (
                    <SaveToListMenu
                      trigger={
                        <Button variant="outline" size="xs" className="text-xs">
                          Save to…
                        </Button>
                      }
                      onSave={async (listId) => {
                        const r = await fetch(`/api/lists/${listId}/items`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ submissionId: s.id }),
                        });
                        if (!r.ok) return { ok: false };
                        const data = await r.json();
                        return { ok: true, added: data.added, skipped: data.skipped };
                      }}
                    />
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
                onApprove={() => approveItem(s.id, '')}
                onReject={() => rejectItem(s.id)}
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
  onApprove,
  onReject,
  pending,
}: {
  id: string;
  onApprove: (id: string, note: string) => void;
  onReject: (id: string) => void;
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
          onClick={() => onApprove(id, note)}
          disabled={pending}
        >
          {pending ? 'Working…' : 'Approve'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 sm:flex-none px-4 py-2.5 text-sm sm:px-3 sm:py-1.5 sm:text-xs"
          onClick={() => onReject(id)}
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
