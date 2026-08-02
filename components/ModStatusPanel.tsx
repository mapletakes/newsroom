'use client';

import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetClose, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { RailTab } from '@/components/DeckRail';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { queryKeys } from '@/lib/query-keys';
import { useModStatusRealtime } from '@/lib/use-mod-status-realtime';
import { relativeTime } from '@/lib/url';
import {
  isStatusStale,
  MAX_STATUS_NOTE_CHARS,
  MOD_STATUSES,
  MOD_STATUS_LABELS,
  MOD_STATUS_SHORT,
  type ModStatus,
  type ModStatusValue,
} from '@/lib/mod-status';

export type ModStatusRow = {
  twitchUserId: string;
  login: string;
  status: ModStatusValue;
  note: string | null;
  updatedAt: string | null;
  isSelf: boolean;
};

async function fetchRoster(): Promise<ModStatusRow[]> {
  const r = await fetch('/api/mod-status');
  if (!r.ok) return [];
  const d = await r.json();
  return d.mods || [];
}

// Written out rather than built from MOD_STATUS_TOKEN — Tailwind's JIT scans
// source for literal class strings, so an interpolated `bg-${token}` only
// works by accident, when some unrelated file happens to use the same class.
const DOT_CLASS: Record<ModStatus, string> = {
  green: 'bg-moss',
  yellow: 'bg-ochre',
  red: 'bg-rust',
};

const TEXT_CLASS: Record<ModStatus, string> = {
  green: 'text-moss',
  yellow: 'text-ochre',
  red: 'text-rust',
};

function StatusDot({ status, className }: { status: ModStatusValue; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block w-2.5 h-2.5 shrink-0 rounded-full',
        // A never-set status is drawn as a hollow ring rather than a grey
        // dot: "hasn't said" shouldn't read as a fourth availability level
        // at a glance.
        status ? DOT_CLASS[status] : 'border border-ink/40',
        className,
      )}
      aria-hidden="true"
    />
  );
}

/** One roster line. Self rows are styled the same as everyone else's — the
 *  editing affordance lives below the list, not inline, so the board reads
 *  as one scannable column rather than one odd row among others. */
function RosterRow({ m }: { m: ModStatusRow }) {
  const stale = isStatusStale(m.updatedAt);
  return (
    <div className="flex items-baseline gap-2 py-1.5">
      <StatusDot status={m.status} className="translate-y-[3px]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5 flex-wrap">
          <span className="font-mono text-sm">{m.login}</span>
          {m.isSelf && (
            <span className="font-mono text-[9px] uppercase tracking-widest text-ink/40">you</span>
          )}
          <span
            className={cn(
              'font-mono text-[10px] uppercase tracking-widest',
              m.status ? TEXT_CLASS[m.status] : 'text-ink/35',
            )}
          >
            {m.status ? MOD_STATUS_SHORT[m.status] : 'no status'}
          </span>
        </span>
        {m.note && <span className="block text-xs text-ink/70 leading-snug">{m.note}</span>}
        {m.updatedAt && (
          // The age is never optional. A status is a claim someone made at a
          // point in time, and this feature deliberately has no heartbeat to
          // check it against — so the timestamp is the only thing that stops
          // a four-hour-old "attentive" from reading as current.
          <span className={cn('block font-mono text-[10px]', stale ? 'text-rust' : 'text-ink/40')}>
            {stale && '⚠ '}
            {relativeTime(m.updatedAt)}
          </span>
        )}
      </span>
    </div>
  );
}

/** The set-your-own control. Only rendered when the viewer actually has a
 *  moderators row — the streamer reads this board but has no row to set. */
function SelfControl({
  me,
  onSave,
  saving,
}: {
  me: ModStatusRow;
  onSave: (status: ModStatusValue, note: string) => void;
  saving: boolean;
}) {
  const [note, setNote] = useState(me.note ?? '');

  // Follow the server when someone else's write (or our own) lands, but only
  // while the field isn't being edited — otherwise a background refetch
  // yanks half-typed text out from under the person typing it.
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setNote(me.note ?? '');
  }, [me.note, focused]);

  return (
    <div className="border-t border-ink/20 p-3">
      <span className="block font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-2">
        Your availability
      </span>
      <div className="flex gap-1 mb-2">
        {MOD_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={saving}
            onClick={() => onSave(s, note)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 border px-2 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors disabled:opacity-40',
              me.status === s ? 'border-ink bg-ink text-paper' : 'border-ink/30 hover:border-ink',
            )}
            title={MOD_STATUS_LABELS[s]}
          >
            <span className={cn('inline-block w-2 h-2 rounded-full', DOT_CLASS[s])} />
            {MOD_STATUS_SHORT[s]}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <Input
          value={note}
          maxLength={MAX_STATUS_NOTE_CHARS}
          onChange={(e) => setNote(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSave(me.status, note);
            }
          }}
          placeholder="Optional — e.g. back in 20"
          className="flex-1 min-w-0 text-xs"
          aria-label="Status note"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={saving}
          onClick={() => onSave(me.status, note)}
        >
          {saving ? '…' : 'Save'}
        </Button>
      </div>
      {me.status && (
        <button
          type="button"
          disabled={saving}
          onClick={() => { setNote(''); onSave(null, ''); }}
          className="mt-2 font-mono text-[10px] uppercase tracking-widest text-ink/40 hover:text-ink"
        >
          Clear my status
        </button>
      )}
    </div>
  );
}

/** Shared data + mutation wiring for both surfaces. */
function useModStatus(streamId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const key = queryKeys.modStatus(streamId);

  const { data } = useQuery({
    queryKey: key,
    queryFn: fetchRoster,
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: 120000,
  });

  useModStatusRealtime(enabled ? streamId : null, () => {
    queryClient.invalidateQueries({ queryKey: key });
  });

  const mutation = useMutation({
    mutationFn: async (vars: { status: ModStatusValue; note: string }) => {
      const r = await fetch('/api/mod-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: vars.status, note: vars.note }),
      });
      if (!r.ok) throw new Error('failed');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const mods = data ?? [];
  return { mods, me: mods.find((m) => m.isSelf) ?? null, mutation };
}

/**
 * The mod availability board.
 *
 * Self-reported and deliberately not presence — see lib/mod-status.ts. Every
 * row shows how old its status is, because without a heartbeat that timestamp
 * is the only thing separating a board people trust from one they learn to
 * ignore.
 *
 * `variant` picks the surface:
 *   'tab'    — launcher in the deck's left-edge DeckRail, for the streamer,
 *              who reads the board and (being absent from `moderators`) has
 *              nothing of their own to set.
 *   'inline' — the strip in the mod view, where the person looking at it
 *              usually does have a row of their own.
 *   'menu'   — drawer only, no trigger of its own; opened from the mobile
 *              deck's ☰ menu via `open`/`onOpenChange`. A fourth icon in
 *              that header doesn't fit: at 375px the wordmark has no
 *              shrink-0, so the extra control squeezes "The Broadside" onto
 *              two lines and the header grows from 62px to 82px.
 */
export function ModStatusPanel({
  streamId,
  enabled,
  variant,
  open,
  onOpenChange,
}: {
  streamId: string;
  enabled: boolean;
  variant: 'tab' | 'menu' | 'inline';
  /** Only for variant='menu' — the caller owns the open state. */
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const { mods, me, mutation } = useModStatus(streamId, enabled);

  if (!enabled) return null;

  const save = (status: ModStatusValue, note: string) => mutation.mutate({ status, note });
  // Only counts a status someone actually stands behind right now — a stale
  // green would otherwise inflate the "attentive" figure on the rail badge,
  // which is exactly the lie this feature is designed not to tell.
  const attentive = mods.filter((m) => m.status === 'green' && !isStatusStale(m.updatedAt)).length;

  const body = (
    <>
      <div className="flex-1 overflow-y-auto p-3">
        {mods.length === 0 ? (
          <p className="font-mono text-[11px] text-ink/40 px-2 py-6 text-center leading-relaxed">
            No mods have signed in to The Broadside yet.
          </p>
        ) : (
          <div className="divide-y divide-ink/10">
            {mods.map((m) => <RosterRow key={m.twitchUserId} m={m} />)}
          </div>
        )}
      </div>
      {me && <SelfControl me={me} onSave={save} saving={mutation.isPending} />}
    </>
  );

  if (variant === 'inline') {
    return (
      <div className="flex flex-col border border-ink/20">
        <div className="flex items-center gap-2 border-b border-ink/20 px-3 py-2">
          <span className="font-mono text-xs uppercase tracking-widest text-ink/60">Mod availability</span>
          <span className="font-mono text-[10px] text-ink/40">
            {attentive}/{mods.length} attentive
          </span>
        </div>
        {body}
      </div>
    );
  }

  return (
    <Sheet
      {...(variant === 'menu' ? { open: !!open, onOpenChange } : {})}
    >
      {variant === 'tab' && (
        <SheetTrigger asChild>
          <RailTab icon="radioChecked" label="Mods" count={attentive} />
        </SheetTrigger>
      )}
      <SheetContent side="left">
        <div className="flex items-center gap-2 border-b-2 border-ink px-4 py-3">
          <Icon name="radioChecked" className="text-ink" />
          <SheetTitle>Mod availability</SheetTitle>
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
