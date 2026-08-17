'use client';

import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetClose, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Icon } from '@/components/ui/icon';
import { RailTab } from '@/components/DeckRail';
import { queryKeys } from '@/lib/query-keys';
import { useRaffleRealtime } from '@/lib/use-raffle-realtime';
import { DEFAULT_RAFFLE_COMMAND, MAX_WINNER_COUNT, type RaffleStatus } from '@/lib/raffle';

type RaffleData = {
  id: string;
  command: string;
  winnerCount: number;
  status: RaffleStatus;
  openedAt: string;
  closesAt: string;
  closedAt: string | null;
  winnersAnnouncedAt: string | null;
  startedByLogin: string | null;
  subsVipsOnly: boolean;
  entryCount: number;
  winners: string[];
};

async function fetchRaffle(): Promise<RaffleData | null> {
  const r = await fetch('/api/raffle');
  if (!r.ok) return null;
  const d = await r.json();
  return d.raffle ?? null;
}

function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The deck's chat-raffle control: start one with a duration/winner-count/
 * command, watch entries roll in, then draw and announce. Its own drawer
 * rather than folded into Questions or ModStatus — a raffle is a timed
 * EVENT with a lifecycle, not a running list either of those triage.
 *
 * `variant` mirrors QuestionsPanel's: 'tab' is a RailTab launcher for the
 * desktop deck's left-edge rail, 'icon' a compact button for the mobile
 * header menu.
 */
export function RafflePanel({
  streamId,
  enabled,
  variant,
  open,
  onOpenChange,
}: {
  streamId: string;
  enabled: boolean;
  /** 'tab' — RailTab in the desktop deck's DeckRail, same as ModStatusPanel
   *  and QuestionsPanel. 'icon' — compact header button, room for which the
   *  mobile deck currently only has for one panel (Questions). 'menu' — no
   *  trigger of its own; opened from the mobile deck's ☰ menu via
   *  `open`/`onOpenChange`, same reasoning as ModStatusPanel's — a second
   *  header icon alongside Questions' is exactly what wraps the wordmark at
   *  375px. */
  variant: 'tab' | 'icon' | 'menu';
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const key = queryKeys.raffle(streamId);

  const { data: raffle } = useQuery({
    queryKey: key,
    queryFn: fetchRaffle,
    enabled,
    placeholderData: keepPreviousData,
    // Slower than the countdown itself needs — the visible "mm:ss left" is
    // computed client-side from closesAt (see `now` below) and ticks every
    // second on its own. This poll is only the backstop for status changes
    // (closed, someone else's entry landed) that realtime didn't deliver.
    refetchInterval: 10000,
  });

  useRaffleRealtime(enabled ? streamId : null, () => {
    queryClient.invalidateQueries({ queryKey: key });
  });

  // Ticks the countdown display, and — the one place this component acts on
  // time rather than just showing it — fires one refetch the moment a
  // locally-computed countdown hits zero. Without this, a raffle whose timer
  // just ran out would sit reading "0:00" until the next 10s poll or the
  // next chat entry happened to trigger the server's lazy close.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (raffle?.status !== 'open') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [raffle?.status]);
  useEffect(() => {
    if (raffle?.status === 'open' && new Date(raffle.closesAt).getTime() <= now) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  }, [now, raffle?.status, raffle?.closesAt, queryClient, key]);

  const [startFormOpen, setStartFormOpen] = useState(false);
  const [command, setCommand] = useState(DEFAULT_RAFFLE_COMMAND);
  const [minutes, setMinutes] = useState('2');
  const [winnerCount, setWinnerCount] = useState('1');
  const [subsVipsOnly, setSubsVipsOnly] = useState(false);

  const startMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/raffle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          durationSeconds: Math.round(parseFloat(minutes || '0') * 60),
          winnerCount: parseInt(winnerCount, 10),
          subsVipsOnly,
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.detail || e.error || `failed (${r.status})`);
      }
    },
    onSuccess: () => {
      setStartFormOpen(false);
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const endMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/raffle/end', { method: 'POST' });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.detail || e.error || `failed (${r.status})`);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const announceMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/raffle/announce', { method: 'POST' });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.detail || e.error || `failed (${r.status})`);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const rerollMutation = useMutation({
    mutationFn: async (winnerLogin: string) => {
      const r = await fetch('/api/raffle/reroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winnerLogin }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.detail || e.error || `failed (${r.status})`);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  if (!enabled) return null;

  const showForm = !raffle || raffle.status === 'closed' ? startFormOpen || !raffle : false;

  const body = (
    <div className="flex-1 overflow-y-auto p-3">
      {raffle?.status === 'open' && (
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="font-mono text-sm font-bold">{raffle.command}</span>
            <span className="font-mono text-2xl font-bold tabular-nums">
              {mmss(new Date(raffle.closesAt).getTime() - now)}
            </span>
          </div>
          <p className="font-mono text-[11px] text-ink/50 mb-4">
            {raffle.entryCount} {raffle.entryCount === 1 ? 'entry' : 'entries'} ·{' '}
            {raffle.winnerCount} {raffle.winnerCount === 1 ? 'winner' : 'winners'} to draw
            {raffle.startedByLogin && <> · started by {raffle.startedByLogin}</>}
            {raffle.subsVipsOnly && (
              <>
                {' '}
                · <span className="text-ochre font-bold">subs &amp; VIPs only</span>
              </>
            )}
          </p>
          {endMutation.isError && (
            <p className="font-mono text-[10px] text-rust mb-2">⚠ {endMutation.error.message}</p>
          )}
          <Button
            variant="outlineDestructive"
            size="sm"
            onClick={() => endMutation.mutate()}
            disabled={endMutation.isPending}
          >
            {endMutation.isPending ? 'Ending…' : 'End raffle now'}
          </Button>
        </div>
      )}

      {raffle?.status === 'closed' && !showForm && (
        <div>
          <p className="font-mono text-[11px] text-ink/50 mb-2">
            {raffle.entryCount} {raffle.entryCount === 1 ? 'entry' : 'entries'} · closed
            {raffle.subsVipsOnly && (
              <>
                {' '}
                · <span className="text-ochre font-bold">subs &amp; VIPs only</span>
              </>
            )}
          </p>
          {raffle.winners.length === 0 ? (
            <p className="text-sm text-ink/60 mb-4">Nobody entered — no winners to draw.</p>
          ) : (
            <ul className="mb-4 space-y-1">
              {raffle.winners.map((w) => (
                <li key={w} className="flex items-center gap-1.5 justify-between font-mono text-sm font-bold">
                  <span className="flex items-center gap-1.5">
                    <Icon name="raffle" className="text-ink/50" />
                    {w}
                  </span>
                  <Button
                    variant="outline"
                    size="xs"
                    className="text-[11px] font-mono normal-case"
                    onClick={() => rerollMutation.mutate(w)}
                    disabled={rerollMutation.isPending || raffle.entryCount <= raffle.winners.length}
                    title={
                      raffle.entryCount <= raffle.winners.length
                        ? 'No other entrants left to draw'
                        : 'Draw a new winner in place of this one'
                    }
                  >
                    {rerollMutation.isPending && rerollMutation.variables === w ? '…' : 'Reroll'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {rerollMutation.isError && (
            <p className="font-mono text-[10px] text-rust mb-2">⚠ {rerollMutation.error.message}</p>
          )}
          {announceMutation.isError && (
            <p className="font-mono text-[10px] text-rust mb-2">⚠ {announceMutation.error.message}</p>
          )}
          <div className="flex gap-2 flex-wrap">
            {raffle.winnersAnnouncedAt ? (
              <span className="font-mono text-[11px] uppercase tracking-widest text-moss self-center">
                Announced to chat ✓
              </span>
            ) : (
              <Button
                variant="moss"
                size="sm"
                onClick={() => announceMutation.mutate()}
                disabled={announceMutation.isPending || raffle.winners.length === 0}
              >
                {announceMutation.isPending ? 'Posting…' : 'Announce to chat'}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setStartFormOpen(true)}>
              Start new raffle
            </Button>
          </div>
        </div>
      )}

      {showForm && (
        <div>
          {raffle && (
            <button
              type="button"
              onClick={() => setStartFormOpen(false)}
              className="font-mono text-[10px] uppercase tracking-widest text-ink/40 hover:text-ink mb-3"
            >
              ← Back to results
            </button>
          )}
          <label className="block font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">
            Entry command
          </label>
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={DEFAULT_RAFFLE_COMMAND}
            className="mb-3 text-sm"
            aria-label="Entry command"
          />
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">
                Minutes
              </label>
              <Input
                type="number"
                min="0.25"
                step="0.25"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                className="text-sm"
                aria-label="Duration in minutes"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">
                Winners
              </label>
              <Input
                type="number"
                min="1"
                max={MAX_WINNER_COUNT}
                value={winnerCount}
                onChange={(e) => setWinnerCount(e.target.value)}
                className="text-sm"
                aria-label="Number of winners"
              />
            </div>
          </div>
          <label className="flex items-center gap-1.5 mb-4 font-mono text-[10px] uppercase tracking-widest text-ink/60 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={subsVipsOnly}
              onChange={(e) => setSubsVipsOnly(e.target.checked)}
            />
            Subs &amp; VIPs only
          </label>
          {startMutation.isError && (
            <p className="font-mono text-[10px] text-rust mb-2">⚠ {startMutation.error.message}</p>
          )}
          <Button onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
            {startMutation.isPending ? 'Starting…' : 'Start raffle'}
          </Button>
          <p className="text-xs text-ink/50 mt-2">
            Announces to chat when it starts and when it closes. Chatters type the command above
            once each to enter — repeats don&apos;t count twice.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <Sheet {...(variant === 'menu' ? { open: !!open, onOpenChange } : {})}>
      {variant !== 'menu' && (
        <SheetTrigger asChild>
          {variant === 'tab' ? (
            <RailTab icon="raffle" label="Raffle" count={raffle?.status === 'open' ? raffle.entryCount : 0} />
          ) : (
            <button
              className="relative w-11 h-11 inline-flex items-center justify-center rounded border border-ink/20"
              aria-label="Open raffle"
              title="Raffle"
            >
              <Icon name="raffle" className="text-lg" />
              {raffle?.status === 'open' && (
                <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 flex items-center justify-center rounded-full bg-rust text-paper font-mono text-[9px] font-bold">
                  {raffle.entryCount}
                </span>
              )}
            </button>
          )}
        </SheetTrigger>
      )}

      <SheetContent side="left">
        <div className="flex items-center gap-2 border-b-2 border-ink px-4 py-3">
          <Icon name="raffle" className="text-ink" />
          <SheetTitle>Raffle</SheetTitle>
          <SheetClose asChild>
            <button className="ml-auto text-ink/50 hover:text-rust" aria-label="Close">
              <Icon name="close" />
            </button>
          </SheetClose>
        </div>
        {body}
      </SheetContent>
    </Sheet>
  );
}
