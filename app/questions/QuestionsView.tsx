'use client';

import { useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SwipeRow } from '@/components/SwipeRow';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuestionsRealtime } from '@/lib/use-questions-realtime';
import { queryKeys } from '@/lib/query-keys';
import { relativeTime } from '@/lib/url';

export type Question = {
  id: string;
  text: string;
  asker_login: string | null;
  asker_is_sub: boolean | null;
  asker_is_mod: boolean | null;
  asker_is_vip: boolean | null;
  status: 'pending' | 'approved' | 'rejected' | 'answered';
  position: number | null;
  created_at: string;
};

const STATUS_KEYS = ['pending', 'approved', 'answered', 'rejected'] as const;
type StatusKey = (typeof STATUS_KEYS)[number];
function isStatusKey(s: string): s is StatusKey {
  return (STATUS_KEYS as readonly string[]).includes(s);
}

type Counts = { pending: number; approved: number; answered: number; rejected: number; total: number };
type Data = { questions: Question[]; counts: Counts };
const EMPTY_COUNTS: Counts = { pending: 0, approved: 0, answered: 0, rejected: 0, total: 0 };

async function fetchQuestions(filter: string): Promise<Data> {
  const r = await fetch(`/api/questions?status=${filter}`);
  if (!r.ok) throw new Error('Failed to load questions');
  const data = await r.json();
  return { questions: data.questions || [], counts: data.counts || EMPTY_COUNTS };
}

/**
 * Mod/streamer Q&A triage — separate from the deck entirely, same as
 * requested: a link is played once, but a question has its own lifecycle
 * (pending → approved → answered, or rejected), and mixing the two into one
 * queue would make neither easy to scan during an interview.
 *
 * Every mod can triage here, not just curate-authorized ones — this is
 * moderation (screening what reaches the streamer), the same class of
 * action as approve/reject on submissions, not deck organizing.
 */
export function QuestionsView({
  streamId,
  displayName,
  channel,
  isMod,
  isAdmin,
  questionCommand,
}: {
  streamId: string;
  displayName: string;
  channel: string;
  isMod: boolean;
  isAdmin: boolean;
  questionCommand: string | null;
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<StatusKey>('pending');
  const dataKey = queryKeys.questions(streamId, filter);
  const allFiltersKey = queryKeys.questions(streamId);

  const { data, isPending: loading } = useQuery({
    queryKey: dataKey,
    queryFn: () => fetchQuestions(filter),
    placeholderData: keepPreviousData,
    refetchInterval: 120000,
  });
  const questions = data?.questions ?? [];
  const counts = data?.counts ?? EMPTY_COUNTS;
  const loaded = !loading;

  useQuestionsRealtime(streamId, () => {
    queryClient.invalidateQueries({ queryKey: allFiltersKey });
  });

  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const patchMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const r = await fetch('/api/questions', {
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

  const mutate = async (id: string, patch: Record<string, unknown>) => {
    setRowErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setPendingIds((prev) => new Set(prev).add(id));

    let ok = true;
    let error: string | undefined;
    try {
      await patchMutation.mutateAsync({ id, patch });
    } catch (err) {
      ok = false;
      error = err instanceof Error ? err.message : 'Action failed';
    }

    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    if (!ok) {
      setRowErrors((prev) => ({ ...prev, [id]: error! }));
      return;
    }

    // Move the card out of this tab immediately rather than waiting on the
    // realtime round trip — same reasoning as the mod queue's submissions.
    const prevItem = questions.find((q) => q.id === id);
    const newStatus = typeof patch.status === 'string' ? patch.status : null;
    if (prevItem && newStatus && newStatus !== filter && isStatusKey(prevItem.status) && isStatusKey(newStatus)) {
      queryClient.setQueryData<Data>(dataKey, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          questions: prev.questions.filter((q) => q.id !== id),
          counts: {
            ...prev.counts,
            [prevItem.status]: Math.max(0, prev.counts[prevItem.status as StatusKey] - 1),
            [newStatus]: prev.counts[newStatus as StatusKey] + 1,
          },
        };
      });
    }
    queryClient.invalidateQueries({ queryKey: allFiltersKey });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader
        className="border-b-2 border-ink px-6 py-3 gap-6"
        section={<>questions{isMod && <> · {displayName}</>}</>}
        right={
          <>
            <span className="uppercase tracking-widest">#{channel}</span>
            {!isMod && <Link href="/deck" className="underline hover:text-rust">Streamer Deck →</Link>}
            {isMod && <Link href="/mod" className="underline hover:text-rust">Mod View →</Link>}
            {!isMod && <Link href="/setup#questions" className="underline hover:text-rust">Settings</Link>}
            {isAdmin && <Link href="/admin" className="underline hover:text-rust">Admin</Link>}
          </>
        }
      />

      <div className="px-3 sm:px-6 py-3 border-b border-ink/20 flex items-center gap-1 flex-wrap font-mono text-xs uppercase">
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => { if (v) setFilter(v as StatusKey); }}
        >
          {STATUS_KEYS.map((k) => (
            <ToggleGroupItem key={k} value={k} variant="tab">
              {k} ({counts[k]})
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {questionCommand && (
          <span className="ml-auto text-ink/50">
            command: <code className="text-ink/70">{questionCommand}</code>
          </span>
        )}
      </div>

      <main className="px-3 sm:px-6 py-6 max-w-3xl mx-auto w-full">
        {!loaded ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card-paper p-4">
                <Skeleton className="h-4 w-32 mb-2" />
                <Skeleton className="h-6 w-full" />
              </div>
            ))}
          </div>
        ) : questions.length === 0 ? (
          <div className="text-center py-24">
            <p className="font-display text-2xl mb-2">
              {filter === 'pending' && 'No questions waiting.'}
              {filter === 'approved' && 'Nothing approved yet.'}
              {filter === 'answered' && 'Nothing marked answered yet.'}
              {filter === 'rejected' && 'No rejected questions.'}
            </p>
            <p className="text-ink/60 font-mono text-sm">
              {filter === 'pending' && (
                questionCommand
                  ? <>When chat types <code>{questionCommand}</code>, it lands here in seconds.</>
                  : 'Set a question command in Settings to start collecting these.'
              )}
              {filter === 'approved' && 'Approve a pending question to send it to the streamer.'}
              {filter === 'answered' && "Questions the streamer's handled show up here."}
              {filter === 'rejected' && 'Rejected questions land here — you can send any back to pending.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {questions.map((q) => {
              const card = (
                <QuestionRow
                  key={q.id}
                  q={q}
                  pending={pendingIds.has(q.id)}
                  error={rowErrors[q.id]}
                  actions={<QuestionActions q={q} mutate={mutate} pending={pendingIds.has(q.id)} />}
                />
              );
              if (q.status !== 'pending') return card;
              return (
                <SwipeRow
                  key={q.id}
                  disabled={pendingIds.has(q.id)}
                  onApprove={() => mutate(q.id, { status: 'approved' })}
                  onReject={() => mutate(q.id, { status: 'rejected' })}
                >
                  {card}
                </SwipeRow>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function askerLabel(q: Question): string {
  if (q.asker_is_mod) return '(mod)';
  if (q.asker_is_vip) return '(vip)';
  if (q.asker_is_sub) return '(sub)';
  return '';
}

function QuestionRow({
  q,
  actions,
  pending,
  error,
}: {
  q: Question;
  actions: React.ReactNode;
  pending: boolean;
  error?: string;
}) {
  return (
    <Card className={`p-4 ${pending ? 'opacity-50 pointer-events-none transition-opacity' : ''}`} aria-busy={pending}>
      <div className="flex items-center gap-2 mb-1.5 font-mono text-xs text-ink/50">
        <span>
          {q.asker_login || 'anon'} {askerLabel(q) && <strong className="text-ink/70">{askerLabel(q)}</strong>}
        </span>
        <span>· {relativeTime(q.created_at)}</span>
      </div>
      <p className="text-base leading-relaxed mb-2">{q.text}</p>
      {error && <div className="font-mono text-xs text-rust mb-1">⚠ {error}</div>}
      <div className="flex gap-2 flex-wrap">{actions}</div>
    </Card>
  );
}

function QuestionActions({
  q,
  mutate,
  pending,
}: {
  q: Question;
  mutate: (id: string, patch: Record<string, unknown>) => void;
  pending: boolean;
}) {
  if (q.status === 'pending') {
    return (
      <>
        <Button variant="moss" size="sm" onClick={() => mutate(q.id, { status: 'approved' })} disabled={pending}>
          {pending ? 'Working…' : 'Approve'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => mutate(q.id, { status: 'rejected' })} disabled={pending}>
          Reject
        </Button>
      </>
    );
  }
  if (q.status === 'approved') {
    return (
      <>
        <Button variant="moss" size="sm" onClick={() => mutate(q.id, { status: 'answered' })} disabled={pending}>
          ✓ Mark answered
        </Button>
        <Button variant="outline" size="sm" onClick={() => mutate(q.id, { bump: true })} disabled={pending}>
          ↑ Bump to top
        </Button>
        <Button variant="outlineDestructive" size="sm" onClick={() => mutate(q.id, { status: 'rejected' })} disabled={pending}>
          Reject
        </Button>
      </>
    );
  }
  if (q.status === 'answered') {
    return (
      <Button variant="outline" size="sm" onClick={() => mutate(q.id, { status: 'approved' })} disabled={pending}>
        ↺ Reopen
      </Button>
    );
  }
  // rejected
  return (
    <Button variant="outline" size="sm" onClick={() => mutate(q.id, { status: 'pending' })} disabled={pending}>
      Unreject
    </Button>
  );
}
