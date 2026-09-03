'use client';

// Small, reusable pieces shared by AppThemeSettings and OverlayThemeSettings
// (in ./ThemeSettings.tsx) — colour/font fields, the guided palette builder,
// and the save-row plumbing both panels POST through. Split out as a
// structural move only, no rendered output changed.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SwatchPicker } from '@/components/ui/swatch-picker';
import { cn } from '@/lib/utils';
import {
  contrastRatio,
  DEFAULT_FONTS,
  FONT_CHOICES,
  MIN_TEXT_CONTRAST,
  PALETTE_TOKENS,
  RECIPE_LIMITS,
  sanitizeFontFamily,
  DEFAULT_RECIPE,
  type FontRole,
  type Palette,
  type PaletteRecipe,
  type PaletteToken,
} from '@/lib/theme';

const TOKEN_LABELS: Record<PaletteToken, string> = {
  ink: 'Text',
  paper: 'Background',
  rust: 'Accent / alerts',
  ochre: 'Highlight',
  moss: 'Success',
  slate: 'Info',
};

export function ColorField({
  label,
  value,
  onChange,
  /** Paired colour to grade against, if this slot sits on or under another. */
  against,
  /** WCAG threshold for the size this slot actually renders at. */
  threshold = 4.5,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  against?: string;
  threshold?: number;
}) {
  const ratio = against ? contrastRatio(value, against) : null;
  const poor = ratio !== null && ratio < threshold;
  return (
    <label className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 shrink-0 cursor-pointer border border-ink/30 bg-transparent p-0"
        aria-label={label}
      />
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[11px] truncate">{label}</span>
        {ratio !== null && (
          <span className={`block font-mono text-[10px] ${poor ? 'text-rust font-bold' : 'text-ink/40'}`}>
            {poor ? '⚠ ' : ''}
            {ratio.toFixed(1)}:1
          </span>
        )}
      </span>
    </label>
  );
}

/** One selectable palette, drawn in its own colours so the choice is made by
 *  looking rather than by reading a name. The label sits outside the swatch,
 *  in the page's current theme, so the selected state stays legible whatever
 *  the palette itself looks like. */
export function PaletteCard({
  label,
  palette,
  selected,
  onSelect,
}: {
  label: string;
  /** null renders an empty "not built yet" state, for Custom before use. */
  palette: Palette | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'border p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ochre',
        selected ? 'border-ink ring-2 ring-ink' : 'border-ink/25 hover:border-ink',
      )}
    >
      <span
        className="flex items-center justify-between gap-1 px-2 py-2 mb-1.5 border border-ink/10"
        style={palette ? { background: palette.paper, color: palette.ink } : undefined}
      >
        <span className="font-display text-base font-bold leading-none">Aa</span>
        <span className="flex gap-1">
          {palette
            ? (['rust', 'ochre', 'moss', 'slate'] as const).map((t) => (
                <span key={t} className="w-2 h-2 rounded-full" style={{ background: palette[t] }} />
              ))
            : <span className="font-mono text-[10px] opacity-50">—</span>}
        </span>
      </span>
      <span className="block font-mono text-[10px] uppercase tracking-widest truncate">{label}</span>
    </button>
  );
}

/** The guided builder that replaced six free colour pickers.
 *
 *  Those pickers let a streamer produce a palette that failed the very bar the
 *  built-ins are held to — which is how the default theme shipped an ochre at
 *  2.11:1 behind a risk warning. Here the four accent hues are fixed and only
 *  ground, temperature, tint and intensity are exposed, every combination of
 *  which is proven accessible (see the sweep in lib/theme.test.ts). */
export function CustomPaletteBuilder({
  recipe,
  palette,
  overrides,
  onChange,
  onOverride,
  onResetOverride,
}: {
  recipe: PaletteRecipe | undefined;
  palette: Palette;
  overrides: Partial<Palette>;
  onChange: (recipe: PaletteRecipe) => void;
  onOverride: (token: PaletteToken, hex: string) => void;
  onResetOverride: (token: PaletteToken) => void;
}) {
  const r = recipe ?? DEFAULT_RECIPE;
  const set = (patch: Partial<PaletteRecipe>) => onChange({ ...r, ...patch });

  return (
    <div className="mb-6 p-3 border border-ink/20 grid gap-4 sm:grid-cols-2">
      <div className="grid gap-3 content-start">
        {/* A palette saved with the old pickers has colours but no recipe, so
            the sliders below can't be showing where it came from. Say so
            rather than letting them look authoritative. */}
        {!recipe && (
          <p className="font-mono text-[10px] text-ochre leading-relaxed">
            ⚠ Built with the old colour pickers. Moving anything here rebuilds it.
          </p>
        )}

        <div>
          <span className="block font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Ground</span>
          <ToggleGroup
            type="single"
            value={r.ground}
            onValueChange={(v) => { if (v) set({ ground: v as PaletteRecipe['ground'] }); }}
            className="text-[10px]"
            aria-label="Ground"
          >
            <ToggleGroupItem value="light">Light</ToggleGroupItem>
            <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <RecipeSlider
          label="Temperature" value={r.hue} min={RECIPE_LIMITS.hue.min} max={RECIPE_LIMITS.hue.max}
          step={1} format={(v) => `${Math.round(v)}°`} onChange={(hue) => set({ hue })}
        />
        <RecipeSlider
          label="Paper tint" value={r.tint} min={RECIPE_LIMITS.tint.min} max={RECIPE_LIMITS.tint.max}
          step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(tint) => set({ tint })}
        />
        <RecipeSlider
          label="Accent intensity" value={r.sat} min={RECIPE_LIMITS.sat.min} max={RECIPE_LIMITS.sat.max}
          step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(sat) => set({ sat })}
        />
      </div>

      {/* Derived by default, but each swatch is a real colour picker — the
          guarantee is a good starting point, not a ceiling on what someone
          who wants an exact brand colour can do. Overriding one token never
          touches the others, and the ratio shown is always the CURRENT,
          actually-rendered one, so a pin that drops below the bar is visible
          rather than hidden behind a value that's no longer true. */}
      <div className="grid gap-1 content-start">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">
          Derived — click a swatch to set one explicitly
        </span>
        {PALETTE_TOKENS.map((t) => {
          const ratio = t === 'paper' ? null : contrastRatio(palette[t], palette.paper);
          const poor = ratio !== null && ratio < MIN_TEXT_CONTRAST;
          const pinned = overrides[t] !== undefined;
          return (
            <span key={t} className="flex items-center gap-2">
              <SwatchPicker
                value={palette[t]}
                onChange={(hex) => onOverride(t, hex)}
                label={TOKEN_LABELS[t]}
                isAccessible={t === 'paper' ? undefined : (hex) => contrastRatio(hex, palette.paper) >= MIN_TEXT_CONTRAST}
              />
              <span className="min-w-0 flex-1 font-mono text-[10px] truncate">
                {TOKEN_LABELS[t]}
                {pinned && <span className="text-ink/40"> · pinned</span>}
              </span>
              {pinned && (
                <button
                  type="button"
                  onClick={() => onResetOverride(t)}
                  className="font-mono text-[10px] text-ink/40 hover:text-rust"
                  title={`Reset ${TOKEN_LABELS[t]} to derived`}
                  aria-label={`Reset ${TOKEN_LABELS[t]} to derived`}
                >
                  ×
                </button>
              )}
              <span className={cn('font-mono text-[10px] tabular-nums', poor ? 'text-rust font-bold' : 'text-ink/45')}>
                {ratio === null ? '—' : `${poor ? '⚠ ' : ''}${ratio.toFixed(1)}:1`}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function RecipeSlider({
  label, value, min, max, step, format, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">
        {label}
        <span className="text-ink tabular-nums">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-ink"
      />
    </label>
  );
}

export function FontField({
  label,
  role,
  value,
  onChange,
}: {
  label: string;
  role: FontRole;
  value: string | undefined;
  onChange: (family: string | undefined) => void;
}) {
  const current = value || DEFAULT_FONTS[role];
  const listed = FONT_CHOICES[role].includes(current);
  const [custom, setCustom] = useState(listed ? '' : current);
  const [showCustom, setShowCustom] = useState(!listed);

  return (
    <div>
      <span className="block font-mono text-[11px] text-ink/60 mb-1">{label}</span>
      <select
        value={showCustom ? '__custom' : current}
        onChange={(e) => {
          if (e.target.value === '__custom') {
            setShowCustom(true);
            return;
          }
          setShowCustom(false);
          onChange(e.target.value === DEFAULT_FONTS[role] ? undefined : e.target.value);
        }}
        className="w-full border border-ink/30 bg-paper px-2 py-1.5 font-mono text-xs focus:outline-none focus:border-ink"
        style={{ fontFamily: `'${current}', sans-serif` }}
      >
        {FONT_CHOICES[role].map((f) => (
          <option key={f} value={f}>
            {f}
            {f === DEFAULT_FONTS[role] ? ' (default)' : ''}
            {/* Called out rather than left to blend in with the curated,
                purely-decorative pairings around it — picking this one is an
                accessibility need, not a look, and the label should say so. */}
            {f === 'OpenDyslexic' ? ' — dyslexia-friendly' : ''}
          </option>
        ))}
        <option value="__custom">Any Google Font…</option>
      </select>
      {showCustom && (
        <>
          <Input
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              const clean = sanitizeFontFamily(e.target.value);
              if (clean) onChange(clean);
            }}
            placeholder="e.g. Instrument Serif"
            className="w-full mt-1 text-xs"
            aria-label={`${label} — custom Google Font name`}
          />
          {custom && !sanitizeFontFamily(custom) && (
            <span className="block mt-1 font-mono text-[10px] text-rust">
              Letters, digits and spaces only — that&apos;s all a Google family name can contain.
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ── Shared save plumbing ──────────────────────────────────────

/** Both halves POST the same endpoint, and it only touches the keys it's
 *  handed — so each can save on its own tab without clobbering the other.
 *
 *  `endpoint` is a parameter because the app-palette editor is reused
 *  verbatim on /preferences, where the identical form writes one person's own
 *  theme (/api/prefs) instead of the channel's (/api/setup). Same shape, same
 *  validation, different row — worth a prop rather than a second copy of the
 *  editor that would drift. */
export function useThemeSave(endpoint = '/api/setup') {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = async (patch: Record<string, unknown>, reloadAfter: boolean) => {
    setSaving(true);
    setError('');
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      if (reloadAfter) setTimeout(() => window.location.reload(), 400);
    } catch {
      setError('Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return { save, saving, saved, error };
}

export function SaveRow({
  onSave,
  onReset,
  saving,
  saved,
  error,
  note,
}: {
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  saved: boolean;
  error: string;
  note?: string;
}) {
  return (
    <>
      <div className="flex items-center gap-3 mt-4">
        <Button onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        {saved && <span className="font-mono text-xs text-moss">Saved ✓</span>}
        {error && <span className="font-mono text-xs text-rust">{error}</span>}
        <button
          type="button"
          onClick={onReset}
          className="ml-auto font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink"
        >
          Reset to defaults
        </button>
      </div>
      {note && <p className="text-xs text-ink/50 mt-2">{note}</p>}
    </>
  );
}
