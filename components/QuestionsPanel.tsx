'use client';

import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetClose, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { RailTab } from '@/components/DeckRail';
import { cn } from '@/lib/utils';
import { queryKeys } from '@/lib/query-keys';
import { useQuestionsRealtime } from '@/lib/use-questions-realtime';
import { relativeTime } from '@/lib/url';
import type { Question } from '@/app/questions/QuestionsView';

type ApprovedData = { questions: Question[]; overlayQuestionId: string | null };

// No streamId param: /api/questions reads it from the session cookie, same
// as every other deck endpoint. The query KEY below still includes it, so
// the cache stays namespaced per stream even though the request itself
// doesn't need the id.
async function fetchApproved(): Promise<ApprovedData> {
  const r = await fetch('/api/questions?status=approved');
  if (!r.ok) return { questions: [], overlayQuestionId: null };
  const d = await r.json();
  return { questions: d.questions || [], overlayQuestionId: d.overlayQuestionId ?? null };
}

/**
 * The streamer/curate-mod's live view of audience questions — approved and
 * waiting, one tap from "answered". Deliberately its own drawer, not a tab
 * bolted onto the queue sidebar: a link is played once, but a question is
 * screened by a mod on a completely separate page (/questions) before it
 * ever reaches here, and mixing the two lists would blur that boundary.
 *
 * `variant` picks the trigger: 'tab' is a launcher in the desktop deck's
 * left-edge DeckRail, alongside "Links" — both are "stuff you keep glancing
 * at during the show", so they share one spot rather than being split across
 * opposite edges of the screen. 'icon' is a compact button for the mobile
 * header, which has no room to spare for a floating side rail.
 */
export function QuestionsPanel({
  streamId,
  enabled,
  open = true,
  variant,
  canSetNowPlaying = false,
}: {
  streamId: string;
  enabled: boolean;
  /** The streamer's own pause (streams.questions_open), distinct from
   *  `enabled` (the admin's account-level flag). Doesn't hide the panel —
   *  approved questions already waiting are still worth seeing — just adds a
   *  note explaining why nothing new is arriving. */
  open?: boolean;
  variant: 'tab' | 'icon';
  /** Gates the overlay takeover only. Reading and answering questions stays
   *  open to every mod who can reach the deck; putting one on the broadcast
   *  is the same class of action as setting what's on air, so it needs the
   *  same grant. The server enforces this too — see
   *  app/api/deck/overlay-question/route.ts. */
  canSetNowPlaying?: boolean;
}) {
  const queryClient = useQueryClient();
  const key = queryKeys.questions(streamId, 'approved');

  const { data } = useQuery({
    queryKey: key,
    queryFn: fetchApproved,
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: 60000,
  });
  const questions = data?.questions ?? [];
  const liveId = data?.overlayQuestionId ?? null;

  useQuestionsRealtime(enabled ? streamId : null, () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.questions(streamId) });
  });

  const answerMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch('/api/questions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'answered' }),
      });
      if (!r.ok) throw new Error('failed');
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ApprovedData>(key);
      queryClient.setQueryData<ApprovedData>(key, (prev) => ({
        questions: (prev?.questions ?? []).filter((q) => q.id !== id),
        // The server drops an answered question off the overlay (see the
        // PATCH handler); mirroring that here stops the badge outliving the
        // card it belongs to for the length of a round trip.
        overlayQuestionId: prev?.overlayQuestionId === id ? null : prev?.overlayQuestionId ?? null,
      }));
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.questions(streamId) }),
  });

  const overlayMutation = useMutation({
    mutationFn: async (id: string | null) => {
      const r = await fetch('/api/deck/overlay-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) {
        // Surfaced rather than swallowed: this control's whole job is putting
        // something on the broadcast, so "did that work?" can't be left to
        // inference from a card that didn't change.
        const e = await r.json().catch(() => ({}));
        throw new Error(e.detail || e.error || `failed (${r.status})`);
      }
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ApprovedData>(key);
      queryClient.setQueryData<ApprovedData>(key, (prev) => ({
        questions: prev?.questions ?? [],
        overlayQuestionId: id,
      }));
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.questions(streamId) }),
  });

  if (!enabled) return null;

  return (
    <Sheet>
      <SheetTrigger asChild>
        {variant === 'tab' ? (
          // Positioned by DeckRail, not by itself — see components/DeckRail.tsx
          // for why the hand-tuned offsets this used to carry are gone.
          <RailTab icon="help" label="Questions" count={questions.length} />
        ) : (
          <button
            className="relative w-11 h-11 inline-flex items-center justify-center rounded border border-ink/20"
            aria-label="Open questions"
            title="Questions"
          >
            <Icon name="help" className="text-lg" />
            {questions.length > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 flex items-center justify-center rounded-full bg-rust text-paper font-mono text-[9px] font-bold">
                {questions.length}
              </span>
            )}
          </button>
        )}
      </SheetTrigger>

      <SheetContent side="left">
        <div className="flex items-center gap-2 border-b-2 border-ink px-4 py-3">
          <Icon name="help" className="text-ink" />
          <SheetTitle>Questions</SheetTitle>
          <SheetClose asChild>
            <button className="ml-auto text-ink/50 hover:text-rust" aria-label="Close">
              <Icon name="close" />
            </button>
          </SheetClose>
        </div>

        {!open && (
          <div className="px-4 py-2 bg-rust/10 border-b border-rust/30 font-mono text-[11px] text-rust">
            ⏸ Paused — chat&apos;s command is quiet. <Link href="/setup#questions" className="underline">Reopen</Link>
          </div>
        )}

        {overlayMutation.isError && (
          <div className="px-4 py-2 bg-rust/10 border-b border-rust/30 font-mono text-[11px] text-rust">
            ⚠ {overlayMutation.error.message}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {questions.length === 0 ? (
            <p className="font-mono text-[11px] text-ink/40 px-2 py-6 text-center leading-relaxed">
              Nothing waiting. Questions show up here once a mod approves one from the chat
              command.
            </p>
          ) : (
            questions.map((q) => {
              const isLive = liveId === q.id;
              return (
                <div
                  key={q.id}
                  className={cn('card-paper p-3', isLive && 'border-rust ring-1 ring-rust')}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[10px] text-ink/50">
                      {q.asker_login || 'anon'} · {relativeTime(q.created_at)}
                    </span>
                    {isLive && (
                      <span className="ml-auto shrink-0 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-rust font-bold">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-rust animate-pulse" />
                        On stream
                      </span>
                    )}
                  </div>
                  <p className="text-sm leading-snug mb-2">{q.text}</p>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="moss"
                      size="xs"
                      onClick={() => answerMutation.mutate(q.id)}
                      disabled={answerMutation.isPending}
                    >
                      ✓ Answered
                    </Button>
                    {canSetNowPlaying && (
                      <Button
                        variant={isLive ? 'outlineDestructive' : 'outline'}
                        size="xs"
                        onClick={() => overlayMutation.mutate(isLive ? null : q.id)}
                        disabled={overlayMutation.isPending}
                        title={
                          isLive
                            ? 'Take this question off the on-air overlay'
                            : 'Put this question on the on-air overlay, with who asked it'
                        }
                      >
                        {isLive ? 'Take down' : 'Show on stream'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-ink/20 p-3">
          <Link href="/questions" className="font-mono text-xs uppercase tracking-widest underline hover:text-rust">
            Manage all questions →
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
