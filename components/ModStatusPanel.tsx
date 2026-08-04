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
  viaMobile: boolean;
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
          {m.status && m.viaMobile && (
            // Self-reported, same as the status itself — the mod ticks a box
            // when they set their status, not inferred from which page they
            // used. That inference (page === on a phone) held right up until
            // mods started keeping /mod-status open in a desktop split-screen
            // alongside the stream, at which point it was just wrong as
            // often as it was right.
            <span
              className="inline-flex items-center gap-0.5 font-mono text-[9px] uppercase tracking-widest text-ink/40"
              title="Marked themselves as on mobile"
            >
              <Icon name="mobile" className="text-[10px]" />
              mobile
            </span>
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
  error,
  justSaved,
}: {
  me: ModStatusRow;
  onSave: (status: ModStatusValue, note: string, viaMobile: boolean) => void;
  saving: boolean;
  /** The server's own error message, not a generic fallback — a save that
   *  fails is otherwise indistinguishable from one that silently succeeded,
   *  which is exactly the "not sure if it's being saved" complaint this
   *  exists to close off. */
  error: string | null;
  justSaved: boolean;
}) {
  const [note, setNote] = useState(me.note ?? '');

  // Follow the server when someone else's write (or our own) lands, but only
  // while the field isn't being edited — otherwise a background refetch
  // yanks half-typed text out from under the person typing it.
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setNote(me.note ?? '');
  }, [me.note, focused]);

  // Self-reported, like everything else here — ticked by the mod, not
  // inferred from which surface they're using (see the roster badge's
  // comment for why that inference stopped being trustworthy). Defaults to
  // their last-saved value and then stops following the server the moment
  // they touch it, same reasoning as `focused` above: once they've expressed
  // a preference this session, a background poll shouldn't silently flip it
  // back before their next save goes through.
  const [mobile, setMobile] = useState(me.viaMobile);
  const [mobileTouched, setMobileTouched] = useState(false);
  useEffect(() => {
    if (!mobileTouched) setMobile(me.viaMobile);
  }, [me.viaMobile, mobileTouched]);

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
            onClick={() => onSave(s, note, mobile)}
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
          onBlur={() => {
            setFocused(false);
            // Clicking a status color saves whatever's in this field *at that
            // click*, so typing a note after already picking a color — a
            // completely natural order — left it sitting here unsent unless
            // Save was clicked again separately. It looked saved locally
            // (this field is uncontrolled, so it just keeps showing what was
            // typed) while nothing reached the server, which is exactly why
            // the note never showed up for anyone else. Saving on blur closes
            // that gap without requiring the extra click.
            if (note !== (me.note ?? '')) onSave(me.status, note, mobile);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSave(me.status, note, mobile);
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
          onClick={() => onSave(me.status, note, mobile)}
        >
          {saving ? '…' : 'Save'}
        </Button>
      </div>
      <label className="flex items-center gap-1.5 mt-2 font-mono text-[10px] uppercase tracking-widest text-ink/60 cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={mobile}
          disabled={saving}
          onChange={(e) => {
            // Saves immediately, same as clicking a status color — a
            // checkbox is a discrete, complete action, not something typed
            // over time like the note, so there's no reason to make it wait
            // on a separate Save click. Leaving it bundled-only would
            // reopen exactly the "looked saved, wasn't" gap the note field's
            // onBlur save above exists to close.
            setMobileTouched(true);
            setMobile(e.target.checked);
            onSave(me.status, note, e.target.checked);
          }}
          className="accent-ink"
        />
        <Icon name="mobile" className="text-[11px]" />
        I&apos;m on mobile
      </label>
      {/* Every save ends in one of these two, never silence. */}
      {error && <p className="mt-1.5 font-mono text-[10px] text-rust">⚠ {error}</p>}
      {!error && justSaved && <p className="mt-1.5 font-mono text-[10px] text-moss">Saved ✓</p>}
      {me.status && (
        <button
          type="button"
          disabled={saving}
          onClick={() => { setNote(''); onSave(null, '', mobile); }}
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
    // The app disables this globally (staleTime: Infinity, no
    // refetch-on-focus) so a background refetch can never clobber a mid-edit
    // optimistic update — see query-provider.tsx. Nothing here has that
    // hazard: this board has no optimistic update of its own, and the note
    // field already guards against a refetch stomping live typing via the
    // `focused` check below. Without this override, someone checking who's
    // around gets whatever was cached from up to 2 minutes ago — which is
    // exactly the "it's not showing up" gap this closes, since tabbing back
    // to check is the actual moment people look.
    refetchOnWindowFocus: true,
  });

  useModStatusRealtime(enabled ? streamId : null, () => {
    queryClient.invalidateQueries({ queryKey: key });
  });

  const [justSaved, setJustSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: async (vars: { status: ModStatusValue; note: string; viaMobile: boolean }) => {
      const r = await fetch('/api/mod-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: vars.status, note: vars.note, viaMobile: vars.viaMobile }),
      });
      if (!r.ok) {
        // Surfaced verbatim, not a generic "failed" — a save that errors
        // silently is indistinguishable from one that quietly succeeded,
        // which is the whole failure mode this is meant to close off. The
        // route's own real reasons (mod status not enabled, no moderator
        // row for this account, a DB error) are worth seeing as-is.
        const e = await r.json().catch(() => ({}));
        throw new Error(e.detail || e.error || `save failed (${r.status})`);
      }
    },
    onSuccess: () => {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const mods = data ?? [];
  return {
    mods,
    me: mods.find((m) => m.isSelf) ?? null,
    mutation,
    justSaved,
    error: mutation.isError ? mutation.error.message : null,
  };
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
 *   'tab'  — launcher in a left-edge DeckRail. Used on both the streamer's
 *            deck and the mod view, via the same RailTab component, so the
 *            same visual language means the same interaction on both:
 *            fixed to the edge, and the drawer it opens emerges from that
 *            same edge. A first version put an inline bar in the mod view's
 *            normal document flow instead — styled with an expand chevron,
 *            which reads as "opens in place" — and had it pop a detached
 *            left-edge drawer regardless, which is precisely the mismatch
 *            between what a control looks like and what it does that
 *            prompted this rewrite. On the deck the streamer reads the board
 *            and (being absent from `moderators`) has nothing of their own
 *            to set; on the mod view the person looking at it usually does.
 *   'menu' — drawer only, no trigger of its own; opened from the mobile
 *            deck's ☰ menu via `open`/`onOpenChange`. A fourth icon in that
 *            header doesn't fit: at 375px the wordmark has no shrink-0, so
 *            the extra control squeezes "The Broadside" onto two lines and
 *            the header grows from 62px to 82px.
 *   'page' — the whole thing, inline, no Sheet/trigger — for /mod-status, a
 *            standalone page with nothing else on it. Exists because the
 *            drawer is genuinely awkward to reach on a phone that isn't
 *            already sitting on the deck or mod view (open the app, find the
 *            rail tab, then the drawer) when the actual task is a 5-second
 *            check-in.
 *
 * The roster's "mobile" badge (SelfControl's checkbox) is deliberately NOT
 * tied to `variant`. An earlier version tagged every save made through
 * 'page' as viaMobile automatically, on the assumption that reaching this
 * standalone URL meant a phone — true right up until mods started leaving
 * /mod-status open in a desktop split-screen next to the stream, at which
 * point "which surface" stopped meaning "which device." It's a checkbox the
 * mod ticks themselves now, same self-reported principle as the status
 * itself.
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
  variant: 'tab' | 'menu' | 'page';
  /** Only for variant='menu' — the caller owns the open state. */
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const { mods, me, mutation, justSaved, error } = useModStatus(streamId, enabled);

  if (!enabled) return null;

  const save = (status: ModStatusValue, note: string, viaMobile: boolean) =>
    mutation.mutate({ status, note, viaMobile });
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
      {me && (
        <SelfControl me={me} onSave={save} saving={mutation.isPending} error={error} justSaved={justSaved} />
      )}
    </>
  );

  if (variant === 'page') {
    return <div className="flex-1 flex flex-col min-h-0 border border-ink/20">{body}</div>;
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
          {/* A bookmarkable, chrome-free equivalent for a quick phone
              check-in — surfaced here since the drawer is the place people
              already discover this feature. */}
          <a
            href="/mod-status"
            className="ml-auto font-mono text-[10px] uppercase tracking-widest text-ink/40 hover:text-ink underline"
          >
            Open as page →
          </a>
          <SheetClose asChild>
            <button className="text-ink/50 hover:text-rust" aria-label="Close">
              <Icon name="close" />
            </button>
          </SheetClose>
        </div>
        {body}
      </SheetContent>
    </Sheet>
  );
}
