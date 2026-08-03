'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Submission } from '@/components/SubmissionCard';
import { formatClock, formatDuration, kindTint } from '@/lib/url';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Icon } from '@/components/ui/icon';
import { Wordmark } from '@/components/ui/wordmark';
import { DarkModeToggle } from '@/components/DarkModeToggle';
import { TriggerWarningBanner, TriggerWarningEditor } from '@/components/TriggerWarning';
import { QuestionsPanel } from '@/components/QuestionsPanel';
import { ModStatusPanel } from '@/components/ModStatusPanel';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// The deck, for running a show from a phone.
//
// Not a narrowed copy of the desktop deck — a different arrangement of the
// same state, because the jobs differ. Desktop is where a rundown gets built:
// two panes, drag-reordering, segments, related coverage. A phone is where a
// show gets RUN, one-handed, while something else has your attention. So the
// three things you do live — see what's on air, move off it, and pick what's
// next — are the only things that get permanent screen space, and none of
// them is ever more than one gesture away.
//
// Prep-time work isn't reimplemented here. It stays on the desktop deck
// rather than being squeezed into a sheet where it would be worse at both.

const PEEK_H = 56; // visible height of the collapsed queue sheet
const CONTROLS_H = 60; // the always-on transport row above it

// ── Queue sheet ───────────────────────────────────────────────

/**
 * Drag-up queue over the now-playing card.
 *
 * A sheet rather than a tab so what's on air never leaves the screen — the
 * one thing a streamer glancing at their phone mid-sentence needs to still be
 * true. Snaps between a peek (showing what's next) and open; drag decides by
 * distance, and the handle is also a plain tap target so nobody has to
 * discover the gesture.
 */
function QueueSheet({
  items,
  activeId,
  open,
  setOpen,
  totalRemainingSeconds,
  onPlayNow,
  onPlayNext,
  onRemove,
}: {
  items: Submission[];
  activeId: string | null;
  open: boolean;
  setOpen: (v: boolean) => void;
  totalRemainingSeconds: number;
  onPlayNow: (id: string) => void;
  onPlayNext: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [drag, setDrag] = useState(0); // live finger offset, px (+ = downward)
  const startY = useRef<number | null>(null);

  const upNext = items.find((s) => s.id !== activeId) || null;

  const onPointerDown = (e: React.PointerEvent) => {
    startY.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current === null) return;
    const dy = e.clientY - startY.current;
    // Only allow travel toward the state we're not in, so the sheet can't be
    // dragged off its own snap points.
    setDrag(open ? Math.max(0, dy) : Math.min(0, dy));
  };
  const endDrag = () => {
    if (startY.current === null) return;
    startY.current = null;
    // 48px of intent, or it snaps back — a threshold low enough to feel
    // responsive but high enough that a scroll that starts on the handle
    // doesn't toggle the sheet.
    if (Math.abs(drag) > 48) setOpen(drag < 0);
    setDrag(0);
  };

  return (
    <>
      {open && (
        <button
          aria-label="Close queue"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-ink/40"
        />
      )}
      <section
        aria-label="Queue"
        className="fixed inset-x-0 bottom-0 z-40 flex flex-col bg-paper border-t-2 border-ink shadow-[0_-4px_0_rgb(var(--ink)/0.1)] h-[80dvh]"
        style={{
          // '0px', not 0: calc() can't add a unitless zero to a length, and an
          // invalid transform is dropped silently — the sheet would flip its
          // aria-expanded and never actually move.
          transform: `translateY(calc(${open ? '0px' : `80dvh - ${PEEK_H}px`} + ${drag}px))`,
          transition: startY.current === null ? 'transform 220ms cubic-bezier(0.2,0,0,1)' : 'none',
        }}
      >
        {/* Handle: drag target and tap target both. */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          aria-label={open ? 'Collapse queue' : 'Expand queue'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={() => startY.current === null && setOpen(!open)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
          className="shrink-0 touch-none cursor-grab active:cursor-grabbing select-none px-4"
          style={{ height: PEEK_H }}
        >
          <div className="mx-auto mt-1.5 mb-1 h-1 w-10 rounded-full bg-ink/25" />
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-ink/50">
              {open ? `Queue · ${items.length}` : 'Up next'}
            </span>
            <span className="min-w-0 flex-1 truncate font-display text-sm font-bold">
              {open
                ? totalRemainingSeconds > 0
                  ? `${formatDuration(totalRemainingSeconds)} left`
                  : ''
                : upNext?.title || 'Nothing queued'}
            </span>
            <Icon name={open ? 'expand' : 'collapse'} className="shrink-0 text-ink/40 rotate-90" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-[env(safe-area-inset-bottom)]">
          {items.length === 0 && (
            <p className="py-10 text-center font-mono text-xs text-ink/50">
              Nothing approved yet — your mods fill this from the Mod View.
            </p>
          )}
          {items.map((s) => {
            const isActive = s.id === activeId;
            return (
              <div
                key={s.id}
                className={cn(
                  'flex items-stretch gap-0 border-b border-ink/10',
                  isActive && 'bg-rust/10',
                )}
              >
                <button
                  onClick={() => { onPlayNow(s.id); setOpen(false); }}
                  className={cn(kindTint(s.kind), 'min-w-0 flex-1 text-left py-3 px-2 min-h-[44px]')}
                >
                  <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-ink/50">
                    {isActive && <span className="font-bold text-rust">▶ On air</span>}
                    {s.trigger_warning && <span className="bg-rust text-paper px-1 font-bold">⚠ TW</span>}
                    <span className="truncate">{s.publisher || s.kind.replace('_', ' ')}</span>
                    {s.duration_seconds ? <span>· {formatDuration(s.duration_seconds)}</span> : null}
                  </span>
                  <span className="mt-0.5 block font-display text-base font-bold leading-tight line-clamp-2">
                    {s.title || s.url}
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Actions for ${s.title || s.url}`}
                    className="shrink-0 w-11 flex items-center justify-center text-ink/40 hover:text-ink"
                  >
                    ⋯
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => { onPlayNow(s.id); setOpen(false); }}>
                      ▶ Play now
                    </DropdownMenuItem>
                    {!isActive && (
                      <DropdownMenuItem onSelect={() => onPlayNext(s.id)}>
                        ↑ Play next
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onRemove(s.id)}>
                      ✕ Remove from deck
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

// ── The mobile deck ───────────────────────────────────────────

export function DeckMobile({
  active,
  orderedQueue,
  totalRemainingSeconds,
  elapsedSeconds,
  loaded,
  curateOnly,
  displayName,
  isAdmin,
  streamId,
  questionsEnabled,
  questionsOpen,
  modStatusEnabled,
  canSetNowPlaying = false,
  onSelect,
  onPlayed,
  onSkip,
  onRemove,
  onAnnounce,
  onPlayNext,
  onSaveTriggerWarning,
  onAddUrl,
}: {
  active: Submission | null;
  orderedQueue: Submission[];
  totalRemainingSeconds: number;
  elapsedSeconds: number;
  loaded: boolean;
  curateOnly: boolean;
  displayName: string;
  isAdmin: boolean;
  streamId: string;
  /** Only reaches the questions panel's overlay takeover — see the call site
   *  in DeckView for why now-playing itself isn't gated here. */
  canSetNowPlaying?: boolean;
  questionsEnabled: boolean;
  questionsOpen: boolean;
  modStatusEnabled: boolean;
  onSelect: (id: string) => void;
  onPlayed: () => void;
  onSkip: () => void;
  onRemove: (id: string) => void;
  onAnnounce: () => void;
  onPlayNext: (id: string) => void;
  onSaveTriggerWarning: (id: string, v: string | null) => Promise<{ ok?: boolean } | void> | void;
  onAddUrl: (url: string) => Promise<boolean>;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modStatusOpen, setModStatusOpen] = useState(false);
  const [showWarningEditor, setShowWarningEditor] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [adding, setAdding] = useState(false);

  // A new item on air is a new context: close anything the previous one had
  // open rather than leaving a half-finished warning over the wrong story.
  useEffect(() => {
    setShowWarningEditor(false);
  }, [active?.id]);

  const meta = active
    ? [active.publisher, active.kind.replace('_', ' '), active.duration_seconds ? formatDuration(active.duration_seconds) : null]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* Compact masthead — the desktop one wraps to 170px of nav on a phone,
          which is a fifth of the screen spent on links you rarely tap. */}
      <header className="sticky top-0 z-20 flex items-center gap-2 bg-paper border-b-2 border-ink px-3 py-2">
        <Wordmark />
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink/50">
          {orderedQueue.length} up
        </span>
        <span className="ml-auto flex items-center gap-1">
          <QuestionsPanel
            streamId={streamId}
            enabled={questionsEnabled}
            open={questionsOpen}
            variant="icon"
            canSetNowPlaying={canSetNowPlaying}
          />
          <DarkModeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Menu"
              className="w-11 h-11 inline-flex items-center justify-center rounded border border-ink/20"
            >
              ☰
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {modStatusEnabled && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    // Let the menu finish closing before the drawer opens —
                    // Radix's menu and dialog otherwise fight over focus in
                    // the same tick and the drawer can open unfocused.
                    e.preventDefault();
                    setTimeout(() => setModStatusOpen(true), 0);
                  }}
                >
                  Mod availability
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild><Link href="/mod">Mod View</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/shelf">Shelf</Link></DropdownMenuItem>
              {!curateOnly && (
                <DropdownMenuItem asChild><Link href="/setup">Settings</Link></DropdownMenuItem>
              )}
              {curateOnly && (
                <DropdownMenuItem asChild><Link href="/preferences">Preferences</Link></DropdownMenuItem>
              )}
              {!curateOnly && (
                <DropdownMenuItem asChild>
                  <a href="/api/notes?format=markdown&commit=1">Export notes</a>
                </DropdownMenuItem>
              )}
              {isAdmin && <DropdownMenuItem asChild><Link href="/admin">Admin</Link></DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled className="opacity-60">{displayName}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </header>

      {/* Now playing. Padded clear of the transport row and the sheet peek so
          the last line of copy is never hidden behind them. */}
      <main
        className="flex-1 px-4 pt-4"
        style={{ paddingBottom: CONTROLS_H + PEEK_H + 16 }}
      >
        {!loaded ? (
          <p className="py-20 text-center font-mono text-xs text-ink/50">Loading the deck…</p>
        ) : !active ? (
          <div className="py-16 text-center">
            <p className="font-display text-2xl mb-2">Nothing on the deck.</p>
            <p className="font-mono text-xs text-ink/60">
              Approve links in the <Link href="/mod" className="underline">Mod View</Link>, or add
              one below.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2 font-mono text-[10px] uppercase tracking-widest">
              <span className="flex items-center gap-1.5 font-bold text-rust">
                <span className="inline-block w-2 h-2 rounded-full bg-rust live-dot" />
                On air
              </span>
              <span className="text-ink/50">{formatClock(elapsedSeconds)}</span>
              {active.dmca_risk === 'high' && <span className="text-rust">⚠ DMCA</span>}
            </div>

            {active.trigger_warning && (
              <TriggerWarningBanner text={active.trigger_warning} className="mb-3" />
            )}

            <h1 className="font-display text-2xl font-black leading-tight mb-1">
              {active.title || active.url}
            </h1>
            {meta && (
              <p className="font-mono text-[11px] uppercase tracking-widest text-ink/60 mb-3">{meta}</p>
            )}

            {active.mod_notes && (
              <div className="mb-3 border-l-4 border-ochre bg-ochre/10 px-3 py-2">
                <span className="block font-mono text-[10px] uppercase tracking-widest text-ochre mb-0.5">
                  Mod note
                </span>
                <span className="text-sm">{active.mod_notes}</span>
              </div>
            )}

            {showWarningEditor && (
              <div className="mb-3 border border-rust/40 p-3">
                <TriggerWarningEditor
                  key={active.id}
                  defaultOpen
                  value={active.trigger_warning}
                  onSave={(v) => onSaveTriggerWarning(active.id, v)}
                />
              </div>
            )}

            {(active.summary || active.description) && (
              <p className="text-sm leading-relaxed mb-3 whitespace-pre-line">
                {active.summary || active.description}
              </p>
            )}

            <a
              href={active.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center min-h-[44px] font-mono text-xs uppercase tracking-widest underline"
            >
              Open source ↗
            </a>
          </>
        )}

        {/* Add a link — collapsed, because on a phone this is the exception. */}
        <div className="mt-6 border-t border-ink/15 pt-3">
          {!showAdd ? (
            <button
              onClick={() => setShowAdd(true)}
              className="min-h-[44px] font-mono text-xs uppercase tracking-widest text-ink/50"
            >
              + Add a link
            </button>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!addUrl.trim()) return;
                setAdding(true);
                const ok = await onAddUrl(addUrl.trim());
                setAdding(false);
                if (ok) { setAddUrl(''); setShowAdd(false); }
              }}
              className="flex gap-1"
            >
              <Input
                type="url"
                inputMode="url"
                autoFocus
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                placeholder="Paste a link…"
                className="flex-1 min-w-0 py-2.5"
                disabled={adding}
              />
              <Button type="submit" size="sm" disabled={adding || !addUrl.trim()} className="shrink-0 min-h-[44px]">
                {adding ? '…' : 'Add'}
              </Button>
            </form>
          )}
        </div>
      </main>

      {/* Transport. Fixed above the sheet peek: the whole point of the mobile
          deck is that "done with this one" is always under your thumb. */}
      {active && (
        <div
          className="fixed inset-x-0 z-30 flex items-stretch gap-1 border-t border-ink/20 bg-paper px-2 py-1.5"
          style={{ bottom: PEEK_H, height: CONTROLS_H }}
        >
          {!curateOnly && (
            <Button variant="moss" onClick={onPlayed} className="flex-1 text-xs px-2">
              ✓ Played
            </Button>
          )}
          {!curateOnly && (
            <Button variant="outline" onClick={onSkip} className="text-xs px-3">
              Skip
            </Button>
          )}
          {!curateOnly && (
            <Button
              variant="outline"
              onClick={onAnnounce}
              aria-label="Post to chat"
              className="text-base px-3 min-w-[44px]"
            >
              <Icon name="announce" />
            </Button>
          )}
          <Button
            variant={active.trigger_warning ? 'destructive' : 'outline'}
            onClick={() => setShowWarningEditor((v) => !v)}
            aria-label={active.trigger_warning ? 'Edit trigger warning' : 'Add trigger warning'}
            className="text-base px-3 min-w-[44px]"
          >
            ⚠
          </Button>
          <Button
            variant="outlineDestructive"
            onClick={() => onRemove(active.id)}
            aria-label="Remove from deck"
            className="text-base px-3 min-w-[44px]"
          >
            <Icon name="remove" />
          </Button>
        </div>
      )}

      <ModStatusPanel
        streamId={streamId}
        enabled={modStatusEnabled}
        variant="menu"
        open={modStatusOpen}
        onOpenChange={setModStatusOpen}
      />

      <QueueSheet
        items={orderedQueue}
        activeId={active?.id ?? null}
        open={sheetOpen}
        setOpen={setSheetOpen}
        totalRemainingSeconds={totalRemainingSeconds}
        onPlayNow={onSelect}
        onPlayNext={onPlayNext}
        onRemove={onRemove}
      />
    </div>
  );
}
