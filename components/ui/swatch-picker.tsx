'use client';

import { useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// A grid of common colours to click, in place of the raw OS colour-wheel
// canvas a bare <input type="color"> opens — fast for "pick something
// reasonable," which is what a swatch override almost always is. Generated,
// not a list of hand-picked hex values: HUES/LIGHTNESS_STEPS below are the
// only numbers anyone has to look at to see the whole grid.
const HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const LIGHTNESS_STEPS = [0.85, 0.72, 0.58, 0.46, 0.34, 0.22];
const SATURATION = 0.65;
const NEUTRAL_STEPS = [0.95, 0.82, 0.68, 0.54, 0.4, 0.26, 0.14, 0.04];

function hslToHex(h: number, s: number, l: number): string {
  const f = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const rgb =
    s === 0
      ? [l, l, l]
      : (() => {
          const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
          const p = 2 * l - q;
          return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)];
        })();
  return '#' + rgb.map((c) => Math.round(Math.min(255, Math.max(0, c * 255))).toString(16).padStart(2, '0')).join('');
}

const NEUTRAL_ROW = NEUTRAL_STEPS.map((l) => hslToHex(0, 0, l));
const HUE_GRID = LIGHTNESS_STEPS.map((l) => HUES.map((h) => hslToHex(h / 360, SATURATION, l)));

function Swatch({
  hex,
  active,
  accessible,
  onClick,
}: {
  hex: string;
  active: boolean;
  /** Renders a small ring on swatches that would pass contrast — a hint, not
   *  a restriction; every swatch here stays clickable regardless. */
  accessible?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hex}
      aria-label={hex}
      className={cn(
        'relative w-5 h-5 shrink-0 border border-black/10 transition-transform hover:scale-110 hover:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ochre focus-visible:z-10',
        active && 'ring-2 ring-ink ring-offset-1 ring-offset-paper scale-110 z-10',
      )}
      style={{ background: hex }}
    >
      {accessible && (
        <span
          className="absolute inset-0 flex items-center justify-center text-[8px] leading-none"
          style={{ color: contrastTextFor(hex) }}
          aria-hidden="true"
        >
          ✓
        </span>
      )}
    </button>
  );
}

/** Cheap black-or-white pick for the accessible-hint checkmark's own
 *  legibility — not a WCAG claim, just enough to keep a tiny glyph visible
 *  against whatever swatch it sits on. */
function contrastTextFor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#000' : '#fff';
}

export function SwatchPicker({
  value,
  onChange,
  label,
  isAccessible,
}: {
  value: string;
  onChange: (hex: string) => void;
  label: string;
  /** Optional: when given, swatches that would pass the caller's own
   *  contrast bar get a small checkmark. Kept as a predicate rather than this
   *  component importing theme-specific contrast math, so a colour picker in
   *  components/ui/ doesn't need to know what "accessible" means here. */
  isAccessible?: (hex: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(value);

  const commit = (hex: string) => {
    onChange(hex);
    setOpen(false);
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setHexInput(value); // fresh each time it opens, not stale from last time
      }}
    >
      <DropdownMenuTrigger
        className="w-6 h-4 shrink-0 border border-ink/20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ochre"
        style={{ background: value }}
        aria-label={`Set ${label} explicitly`}
        title={`Set ${label} explicitly`}
      />
      <DropdownMenuContent align="start" className="w-auto p-2">
        <div className="flex flex-col gap-1 mb-2">
          {HUE_GRID.map((row, i) => (
            <div key={i} className="flex gap-1">
              {row.map((hex) => (
                <Swatch
                  key={hex}
                  hex={hex}
                  active={hex.toLowerCase() === value.toLowerCase()}
                  accessible={isAccessible?.(hex)}
                  onClick={() => commit(hex)}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="flex gap-1 mb-2 pt-2 border-t border-ink/10">
          {NEUTRAL_ROW.map((hex) => (
            <Swatch
              key={hex}
              hex={hex}
              active={hex.toLowerCase() === value.toLowerCase()}
              accessible={isAccessible?.(hex)}
              onClick={() => commit(hex)}
            />
          ))}
        </div>
        {/* Precision fallback — the grid covers "something reasonable" fast,
            this covers "this exact brand hex" without reopening the OS
            colour wheel. */}
        <form
          className="flex items-center gap-1.5 pt-2 border-t border-ink/10"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^#[0-9a-fA-F]{6}$/.test(hexInput)) commit(hexInput);
          }}
        >
          <span
            className="w-4 h-4 shrink-0 border border-ink/20"
            style={/^#[0-9a-fA-F]{6}$/.test(hexInput) ? { background: hexInput } : undefined}
          />
          <input
            value={hexInput}
            onChange={(e) => setHexInput(e.target.value)}
            placeholder="#rrggbb"
            className="min-w-0 flex-1 border border-ink/30 bg-paper px-1.5 py-1 font-mono text-[11px] focus:outline-none focus:border-ink"
            aria-label={`${label} — exact hex value`}
          />
          <button
            type="submit"
            disabled={!/^#[0-9a-fA-F]{6}$/.test(hexInput)}
            className="font-mono text-[10px] uppercase tracking-widest text-ink/60 hover:text-ink disabled:opacity-30 disabled:pointer-events-none"
          >
            Use
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
