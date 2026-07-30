'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueueRealtime } from '@/lib/use-queue-realtime';
import { formatDuration } from '@/lib/url';

type NowPlaying = {
  title: string;
  kind: string;
  publisher: string | null;
  durationSeconds: number | null;
  triggerWarning: string | null;
};

export type OverlayVariant = 'default' | 'minimal' | 'ticker';

const metaLine = (item: NowPlaying) =>
  [item.publisher, item.kind.replace('_', ' '), item.durationSeconds ? formatDuration(item.durationSeconds) : null]
    .filter(Boolean)
    .join(' · ');

// Solid rust rather than the card's paper — a warning that has to be readable
// at a glance over arbitrary stream footage can't rely on a tint. Shown at the
// TOP of the card: the whole point is that it's seen before the item it's
// warning about.
//
// Fixed height, and the warning is clipped rather than wrapped. A browser
// source is a fixed-size window (~800×100), not a page that scrolls, so a bar
// free to grow just pushes the card off the bottom of it. default/ticker
// therefore take these 36px back out of the row underneath instead of adding
// to the card's total; minimal is a 40px chip with nothing to give up, so it
// alone grows — it starts small enough to absorb it.
const TW_BAR_H = 'h-9'; // 36px

function TriggerWarning({ text }: { text: string }) {
  return (
    <div className={`${TW_BAR_H} shrink-0 flex items-center gap-2.5 bg-rust px-3 text-paper`}>
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest font-bold leading-none opacity-90">
        ⚠ Trigger warning
      </span>
      {/* The warning itself gets the rest of the bar at display size — it's
          the part a viewer actually has to read, not the label. */}
      <span className="min-w-0 flex-1 font-display text-xl font-bold leading-none truncate">
        {text}
      </span>
    </div>
  );
}

// The on-air lower third: a broadsheet card (paper, ink border, hard shadow)
// styled after the mod view's "On air" bar, sized to work as an OBS browser
// source. Disappears entirely between items.
// `theme` forces one of the app palettes via a .theme-* scope class (see
// globals.css); null follows the embedding browser's system preference.
// `showBrand` toggles the small "The Broadside" mark — some streamers don't
// want it on their own on-air graphic. `variant` picks the layout:
//   default — the full lower-third (title + publisher/kind/duration)
//   minimal — a slim single-line title-only chip
//   ticker  — the full lower-third plus a "next up" line underneath
// A trigger warning adds a rust bar without changing the card's total height
// in default/ticker (it takes the space back from the meta line), so an
// existing browser source never needs resizing. minimal is the one exception
// — it has nothing to give up, so it grows by the height of the bar.
export function OverlayView({
  token,
  theme,
  showBrand,
  variant,
}: {
  token: string;
  theme: 'light' | 'dark' | 'sepia' | 'contrast' | null;
  showBrand: boolean;
  variant: OverlayVariant;
}) {
  const [streamId, setStreamId] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [next, setNext] = useState<NowPlaying | null>(null);
  const [invalid, setInvalid] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      // no-store: this is a same-URL GET polled repeatedly, and the server
      // already sends Cache-Control: no-store — belt-and-suspenders so the
      // embedding browser's own HTTP cache can't serve a stale copy either.
      const r = await fetch(`/api/deck/overlay?token=${encodeURIComponent(token)}`, {
        cache: 'no-store',
      });
      if (r.status === 401 || r.status === 400) {
        setInvalid(true);
        setNowPlaying(null);
        setNext(null);
        return;
      }
      if (!r.ok) return; // transient server error — keep showing what we have
      const data = await r.json();
      setInvalid(false);
      setStreamId(data.streamId || null);
      setNowPlaying(data.nowPlaying || null);
      setNext(data.next || null);
    } catch {
      // network blip — keep the current card rather than flickering it away
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime pings when the deck changes (including now-playing switches) are
  // the primary path — near-instant, and useQueueRealtime already self-heals
  // a dropped connection with a backoff-retry. This interval is a slow
  // backstop only, for the rare case a subscription can't be re-established
  // at all (an unusual, sandboxed context like OBS's browser source is the
  // one place that's genuinely more likely than a normal browser tab).
  useQueueRealtime(streamId, refresh);
  useEffect(() => {
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  // Setup aid only: a misconfigured source shows a small chip instead of
  // silent nothing. (Streamers see this while configuring, not on air.)
  const themeClass = theme ? `theme-${theme}` : '';

  if (invalid) {
    return (
      <div className={themeClass}>
        <div className="inline-flex items-center gap-2 m-2 border border-rust bg-paper px-3 py-1.5 font-mono text-xs text-rust">
          The Broadside overlay: invalid or missing token — regenerate it in Settings → Quick add.
        </div>
      </div>
    );
  }

  if (!nowPlaying) return null;

  if (variant === 'minimal') {
    return (
      <div
        className={`${themeClass} m-2 inline-flex flex-col bg-paper border-2 border-ink shadow-[3px_3px_0_rgb(var(--ink))] max-w-[600px] overflow-hidden text-ink`}
      >
        {nowPlaying.triggerWarning && <TriggerWarning text={nowPlaying.triggerWarning} />}
        <div className="h-10 flex items-center gap-2 px-3">
          <span className="inline-block w-2 h-2 shrink-0 rounded-full bg-rust live-dot" />
          <span className="font-display text-base font-bold leading-tight truncate">{nowPlaying.title}</span>
          {showBrand && (
            <span className="shrink-0 font-mono text-[8px] uppercase tracking-widest text-ink/40 ml-1">
              The Broadside
            </span>
          )}
        </div>
      </div>
    );
  }

  // Deliberately no credibility/leaning tag here (in either variant): it's a
  // triage aid for the streamer and mods, not something to put on stream in
  // front of viewers.
  const meta = metaLine(nowPlaying);
  const tw = nowPlaying.triggerWarning;

  // 36px warning bar + 48px row = the same 84px the row occupied on its own,
  // so a warning appearing mid-show never moves the card or grows it past the
  // browser source's height. The publisher/kind/duration line is what gives
  // way — when an item carries a warning, that's the line worth losing.
  return (
    <div
      className={`${themeClass} m-2 flex flex-col bg-paper border-2 border-ink shadow-[4px_4px_0_rgb(var(--ink))] overflow-hidden text-ink`}
    >
      {tw && <TriggerWarning text={tw} />}
      <div className={`${tw ? 'h-12' : 'h-[84px]'} flex items-center gap-4 px-4`}>
        <div className="shrink-0 flex flex-col items-center gap-1">
          <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-rust font-bold">
            <span className="inline-block w-2 h-2 rounded-full bg-rust live-dot" />
            On air
          </span>
          {showBrand && !tw && (
            <span className="font-mono text-[8px] uppercase tracking-widest text-ink/40">
              The Broadside
            </span>
          )}
        </div>
        <div className={`shrink-0 w-px self-stretch ${tw ? 'my-2' : 'my-3'} bg-ink/20`} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-xl font-bold leading-tight truncate">
            {nowPlaying.title}
          </div>
          {meta && !tw && (
            <div className="font-mono text-[11px] uppercase tracking-widest text-ink/60 truncate mt-0.5">
              {meta}
            </div>
          )}
        </div>
      </div>
      {variant === 'ticker' && next && (
        <div className="h-7 flex items-center gap-2 px-4 border-t border-ink/15 bg-ink/5">
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-ink/50">
            Up next
          </span>
          <span className="min-w-0 flex-1 font-mono text-[11px] truncate text-ink/70">
            {next.title}
          </span>
        </div>
      )}
    </div>
  );
}
