'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueueRealtime } from '@/lib/use-queue-realtime';
import { useGoogleFonts } from '@/lib/use-google-fonts';
import { formatDuration } from '@/lib/url';
import {
  DEFAULT_OVERLAY_THEME,
  overlayCssVars,
  overlayFontFamilies,
  type OverlayTheme,
} from '@/lib/theme';

export type NowPlaying = {
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

// Every colour below comes from a --ov-* custom property set on the card's
// wrapper, not from the app's palette classes. The overlay is matching someone
// else's branding against arbitrary footage, so each slot is its own decision
// — "the warning bar's red" and "the app's rust" stop being the same colour
// the moment a streamer has a brand. See lib/theme.ts for the slot list.

// Solid fill rather than a tint — a warning that has to be readable at a glance
// over stream footage can't rely on transparency. Shown at the TOP of the card:
// the whole point is that it's seen before the item it's warning about.
//
// Fixed height, and the warning is clipped rather than wrapped. A browser
// source is a fixed-size window (~800×100), not a page that scrolls, so a bar
// free to grow just pushes the card off the bottom of it. Every variant below
// takes these 44px back out of the row underneath instead of adding to the
// card's total.
//
// Both the label and the warning are sized to fill the bar to within ~2px top
// and bottom — the type is as large as 44px can carry. The label stacks onto
// two lines to get there without eating the width the warning needs: spelled
// out rather than abbreviated to "TW", since the one viewer who most needs to
// read it is the one who doesn't know the shorthand.
const TW_BAR_H = 'h-11'; // 44px

function TriggerWarning({ text }: { text: string }) {
  return (
    <div
      data-ov="warning"
      className={`${TW_BAR_H} shrink-0 flex items-center gap-3 px-3 py-[2px]`}
      style={{ background: 'var(--ov-warnBg)', color: 'var(--ov-warnText)' }}
    >
      {/* Stacked by wrapping inside a fixed width, deliberately not by a <br>
          or a pair of spans: both of those split the label across nodes, and
          it stops reading as the single phrase "trigger warning" to anything
          walking the DOM. The width is sized to break at the space — wide
          enough for "⚠ TRIGGER" even if the mono face falls back to a wider
          one, narrow enough that the whole phrase can never sit on one line. */}
      <span className="ov-mono shrink-0 w-[124px] text-[20px] uppercase tracking-tight font-bold leading-none">
        ⚠ Trigger warning
      </span>
      {/* 40px is the ceiling, not a taste call: it exactly fills the bar's
          40px content box, and a typical display face's descenders spill only
          ~0.5px past the line box into the 2px of padding. 44px spills past
          the bar. */}
      <span className="ov-display min-w-0 flex-1 text-[40px] font-black leading-none truncate">
        {text}
      </span>
    </div>
  );
}

// The on-air lower third: a broadsheet card (paper, ink border, hard shadow)
// styled after the mod view's "On air" bar, sized to work as an OBS browser
// source. Disappears entirely between items.
//
// `fallbackPreset` is the legacy `?theme=` URL param. It's used ONLY when the
// stream has no stored overlay theme, so a browser source added before per-
// stream theming existed keeps looking exactly as it did; the moment a theme
// is configured in Settings, the stored one wins and the URL stops mattering.
// `showBrand` toggles the small "The Broadside" mark — some streamers don't
// want it on their own on-air graphic. `variant` picks the layout:
//   default — the full lower-third (title + publisher/kind/duration)
//   minimal — a slim single-line title-only chip
//   ticker  — the full lower-third plus a "next up" line underneath
// A trigger warning adds its bar without changing the card's total height in
// default/ticker (it takes the space back from the meta line), so an existing
// browser source never needs resizing. minimal has less to give up, so it
// grows — but stays inside the same 100px source.
export function OverlayView({
  token,
  fallbackPreset,
  showBrand,
  variant,
}: {
  token: string;
  fallbackPreset: string | null;
  showBrand: boolean;
  variant: OverlayVariant;
}) {
  const [streamId, setStreamId] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [next, setNext] = useState<NowPlaying | null>(null);
  const [theme, setTheme] = useState<OverlayTheme | null>(null);
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
      setTheme(data.theme || null);
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
  // one place that's genuinely more likely than a normal browser tab). It's
  // also what carries a mid-show theme change to a source nobody can touch.
  useQueueRealtime(streamId, refresh);
  useEffect(() => {
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  const resolved: OverlayTheme =
    theme ?? { ...DEFAULT_OVERLAY_THEME, preset: fallbackPreset || DEFAULT_OVERLAY_THEME.preset };

  return (
    <OverlayCard
      theme={resolved}
      variant={variant}
      showBrand={showBrand}
      nowPlaying={nowPlaying}
      next={next}
      invalid={invalid}
    />
  );
}

/**
 * The card itself, with no data fetching of its own — every input is a prop.
 *
 * Split out so Settings can preview a theme by rendering the real thing with
 * sample copy, rather than a lookalike that drifts the first time the card
 * changes. That mattered enough to be worth the extra component: the whole
 * point of the preview is telling a streamer what will be on their stream.
 */
export function OverlayCard({
  theme: resolved,
  variant,
  showBrand,
  nowPlaying,
  next,
  invalid = false,
}: {
  theme: OverlayTheme;
  variant: OverlayVariant;
  showBrand: boolean;
  nowPlaying: NowPlaying | null;
  next: NowPlaying | null;
  invalid?: boolean;
}) {
  const vars = overlayCssVars(resolved) as React.CSSProperties;
  useGoogleFonts(overlayFontFamilies(resolved));

  // Setup aid only: a misconfigured source shows a small chip instead of
  // silent nothing. (Streamers see this while configuring, not on air.)
  if (invalid) {
    return (
      <div
        style={vars}
        className="ov-mono inline-flex items-center gap-2 m-2 border px-3 py-1.5 text-xs"
        // Deliberately the warning colours, not the card's: this is an error,
        // and it has to stand out even if the card is themed to be subtle.
      >
        <span style={{ color: 'var(--ov-warnBg)' }}>
          The Broadside overlay: invalid or missing token — regenerate it in Settings → Quick add.
        </span>
      </div>
    );
  }

  if (!nowPlaying) return null;

  const shadow = (px: number) => (resolved.flat ? undefined : `${px}px ${px}px 0 var(--ov-border)`);

  if (variant === 'minimal') {
    return (
      <div
        style={{
          ...vars,
          background: 'var(--ov-cardBg)',
          color: 'var(--ov-cardText)',
          borderColor: 'var(--ov-border)',
          boxShadow: shadow(3),
        }}
        className="m-2 inline-flex flex-col border-2 max-w-[600px] overflow-hidden"
      >
        {nowPlaying.triggerWarning && <TriggerWarning text={nowPlaying.triggerWarning} />}
        {/* The chip gives up 8px of its own 40px when a warning is present —
            not the whole bar's worth, which would leave nothing, but enough
            to keep the total inside a 100px source. */}
        <div className={`${nowPlaying.triggerWarning ? 'h-8' : 'h-10'} flex items-center gap-2 px-3`}>
          <span
            className="inline-block w-2 h-2 shrink-0 rounded-full live-dot"
            style={{ background: 'var(--ov-accent)' }}
          />
          <span className="ov-display text-base font-bold leading-tight truncate">{nowPlaying.title}</span>
          {showBrand && (
            <span className="ov-mono shrink-0 text-[8px] uppercase tracking-widest ml-1 opacity-40">
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

  // 44px warning bar + 40px row = the same 84px the row occupied on its own,
  // so a warning appearing mid-show never moves the card or grows it past the
  // browser source's height. The publisher/kind/duration line is what gives
  // way — when an item carries a warning, that's the line worth losing.
  return (
    <div
      style={{
        ...vars,
        background: 'var(--ov-cardBg)',
        color: 'var(--ov-cardText)',
        borderColor: 'var(--ov-border)',
        boxShadow: shadow(4),
      }}
      className="m-2 flex flex-col border-2 overflow-hidden"
    >
      {tw && <TriggerWarning text={tw} />}
      {/* data-ov marks the two boxes whose heights have to stay in lockstep —
          see the card-height test, and the bug it guards. */}
      <div data-ov="row" className={`${tw ? 'h-10' : 'h-[84px]'} flex items-center gap-4 px-4`}>
        <div className="shrink-0 flex flex-col items-center gap-1">
          <span
            className="ov-mono flex items-center gap-1.5 text-[11px] uppercase tracking-widest font-bold"
            style={{ color: 'var(--ov-accent)' }}
          >
            <span
              className="inline-block w-2 h-2 rounded-full live-dot"
              style={{ background: 'var(--ov-accent)' }}
            />
            On air
          </span>
          {showBrand && !tw && (
            <span className="ov-mono text-[8px] uppercase tracking-widest opacity-40">
              The Broadside
            </span>
          )}
        </div>
        <div
          className={`shrink-0 w-px self-stretch ${tw ? 'my-2' : 'my-3'}`}
          style={{ background: 'rgb(var(--ov-border-rgb) / 0.2)' }}
        />
        <div className="min-w-0 flex-1">
          <div className="ov-display text-xl font-bold leading-tight truncate">
            {nowPlaying.title}
          </div>
          {meta && !tw && (
            <div className="ov-mono text-[11px] uppercase tracking-widest truncate mt-0.5 opacity-60">
              {meta}
            </div>
          )}
        </div>
      </div>
      {variant === 'ticker' && next && (
        <div
          className="h-7 flex items-center gap-2 px-4 border-t"
          style={{
            background: 'var(--ov-nextBg)',
            color: 'var(--ov-nextText)',
            borderColor: 'rgb(var(--ov-border-rgb) / 0.15)',
          }}
        >
          <span className="ov-mono shrink-0 text-[10px] uppercase tracking-widest opacity-70">
            Up next
          </span>
          <span className="ov-mono min-w-0 flex-1 text-[11px] truncate">{next.title}</span>
        </div>
      )}
    </div>
  );
}
