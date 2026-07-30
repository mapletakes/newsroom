'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { OverlayCard, type OverlayVariant } from '@/app/overlay/OverlayView';
import {
  contrastRatio,
  DEFAULT_APP_THEME,
  DEFAULT_FONTS,
  DEFAULT_OVERLAY_THEME,
  FONT_CHOICES,
  OVERLAY_SLOTS,
  OVERLAY_SLOT_LABELS,
  PALETTE_TOKENS,
  resolveAppPalette,
  resolveOverlayColors,
  sanitizeFontFamily,
  type AppTheme,
  type FontRole,
  type OverlaySlot,
  type OverlayTheme,
  type PaletteToken,
} from '@/lib/theme';

const PRESET_LABELS: [string, string][] = [
  ['light', 'Newsprint'],
  ['dark', 'Dark'],
  ['sepia', 'Sepia'],
  ['contrast', 'High contrast'],
];

const TOKEN_LABELS: Record<PaletteToken, string> = {
  ink: 'Text',
  paper: 'Background',
  rust: 'Accent / alerts',
  ochre: 'Highlight',
  moss: 'Success',
  slate: 'Info',
};

/** Which slot each one is graded against, for the contrast readout. */
const CONTRAST_PAIR: Partial<Record<OverlaySlot, OverlaySlot>> = {
  cardBg: 'cardText',
  cardText: 'cardBg',
  accent: 'cardBg',
  warnBg: 'warnText',
  warnText: 'warnBg',
  nextBg: 'nextText',
  nextText: 'nextBg',
};

const SAMPLE = {
  title: 'Senate passes surprise budget bill in 3am vote',
  kind: 'article',
  publisher: 'Reuters',
  durationSeconds: null,
  triggerWarning: null as string | null,
};
const SAMPLE_NEXT = { ...SAMPLE, title: 'The clip everyone is arguing about' };

// ── Small field components ────────────────────────────────────

function ColorField({
  label,
  value,
  onChange,
  /** Paired colour to grade against, if this slot sits on/under another. */
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

function FontField({
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

// ── The section ───────────────────────────────────────────────

export function ThemeSettings({
  initialApp,
  initialOverlay,
}: {
  initialApp: AppTheme;
  initialOverlay: OverlayTheme;
}) {
  const [app, setApp] = useState<AppTheme>(initialApp);
  const [ov, setOv] = useState<OverlayTheme>(initialOverlay);
  const [variant, setVariant] = useState<OverlayVariant>('default');
  const [previewTw, setPreviewTw] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const appPalette = resolveAppPalette(app);
  const ovColors = resolveOverlayColors(ov);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_theme: app, overlay_theme: ov }),
      });
      if (!r.ok) throw new Error();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      // The app's own palette is injected server-side, so it only changes on
      // the next render of a page — reload so the streamer sees what they just
      // picked instead of having to guess.
      setTimeout(() => window.location.reload(), 400);
    } catch {
      setError('Could not save the theme.');
    } finally {
      setSaving(false);
    }
  };

  const resetOverlayToPreset = (preset: string) =>
    setOv({ ...ov, preset, colors: {} }); // clearing overrides is the point of picking a preset

  return (
    <section className="mb-10">
      <h2 className="font-display text-2xl font-bold mb-1">Theme</h2>
      <p className="text-xs text-ink/60 mb-6">
        Two separate looks. The app theme is a <strong>default</strong> — your mods can still switch
        to something they find easier to read. The overlay theme is what your viewers see, so it
        applies exactly as set.
      </p>

      {/* ── App ────────────────────────────────────────────── */}
      <h3 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
        App (deck, mod view, shelf)
      </h3>
      <ToggleGroup
        type="single"
        value={app.preset}
        onValueChange={(v) => { if (v) setApp({ ...app, preset: v, colors: v === 'custom' ? app.colors : {} }); }}
        className="mb-3 text-[10px]"
        aria-label="App palette"
      >
        {PRESET_LABELS.map(([value, label]) => (
          <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>
        ))}
        <ToggleGroupItem value="custom">Custom</ToggleGroupItem>
      </ToggleGroup>

      {app.preset === 'custom' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 p-3 border border-ink/20">
          {PALETTE_TOKENS.map((t) => (
            <ColorField
              key={t}
              label={TOKEN_LABELS[t]}
              value={appPalette[t]}
              // Everything on the deck is read at body size, so this is the
              // one place the strict 4.5 threshold is the right bar.
              against={t === 'paper' ? appPalette.ink : appPalette.paper}
              onChange={(hex) => setApp({ ...app, colors: { ...app.colors, [t]: hex } })}
            />
          ))}
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-3 mb-8">
        {(['display', 'sans', 'mono'] as FontRole[]).map((role) => (
          <FontField
            key={role}
            role={role}
            label={{ display: 'Headlines', sans: 'Body', mono: 'Labels' }[role]}
            value={app.fonts[role]}
            onChange={(family) => setApp({ ...app, fonts: { ...app.fonts, [role]: family } })}
          />
        ))}
      </div>

      {/* ── Overlay ────────────────────────────────────────── */}
      <h3 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
        On-air overlay
      </h3>

      <div className="mb-3 flex flex-wrap gap-2 items-center">
        <ToggleGroup
          type="single"
          value={ov.preset}
          onValueChange={(v) => { if (v) resetOverlayToPreset(v); }}
          className="text-[10px]"
          aria-label="Overlay palette starting point"
        >
          {PRESET_LABELS.map(([value, label]) => (
            <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="font-mono text-[10px] text-ink/40">starting point — tweak any colour below</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 p-3 border border-ink/20">
        {OVERLAY_SLOTS.map((slot) => (
          <ColorField
            key={slot}
            label={OVERLAY_SLOT_LABELS[slot]}
            value={ovColors[slot]}
            against={CONTRAST_PAIR[slot] ? ovColors[CONTRAST_PAIR[slot]!] : undefined}
            // The overlay's type is large and bold, where WCAG asks 3.0
            // rather than 4.5 — grading it at body-text strictness would flag
            // perfectly legible pairings, including the one we ship.
            threshold={3}
            onChange={(hex) => setOv({ ...ov, colors: { ...ov.colors, [slot]: hex } })}
          />
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        {(['display', 'mono'] as const).map((role) => (
          <FontField
            key={role}
            role={role}
            label={role === 'display' ? 'Headline & warning' : 'Labels'}
            value={ov.fonts[role]}
            onChange={(family) => setOv({ ...ov, fonts: { ...ov.fonts, [role]: family } })}
          />
        ))}
      </div>

      <label className="flex items-center gap-2 mb-4 cursor-pointer">
        <input type="checkbox" checked={ov.flat} onChange={(e) => setOv({ ...ov, flat: e.target.checked })} />
        <span className="font-mono text-xs">Flat card (no drop shadow)</span>
      </label>

      {/* ── Preview ────────────────────────────────────────── */}
      <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">Preview</p>
      <div className="mb-2 flex flex-wrap gap-2 items-center">
        <ToggleGroup
          type="single"
          value={variant}
          onValueChange={(v) => { if (v) setVariant(v as OverlayVariant); }}
          className="text-[10px]"
          aria-label="Preview layout"
        >
          <ToggleGroupItem value="default">Full</ToggleGroupItem>
          <ToggleGroupItem value="minimal">Minimal</ToggleGroupItem>
          <ToggleGroupItem value="ticker">Up next</ToggleGroupItem>
        </ToggleGroup>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={previewTw} onChange={(e) => setPreviewTw(e.target.checked)} />
          <span className="font-mono text-[10px]">with a trigger warning</span>
        </label>
      </div>
      {/* Checkerboard, because a browser source is transparent — a preview on
          flat paper hides exactly the problem a streamer needs to catch, which
          is a card that vanishes into their own footage. */}
      <div
        className="p-2 overflow-x-auto border border-ink/20"
        style={{
          backgroundImage:
            'linear-gradient(45deg,rgb(var(--ink)/0.10) 25%,transparent 25%,transparent 75%,rgb(var(--ink)/0.10) 75%),' +
            'linear-gradient(45deg,rgb(var(--ink)/0.10) 25%,transparent 25%,transparent 75%,rgb(var(--ink)/0.10) 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 8px 8px',
        }}
      >
        <div className="min-w-[800px]">
          <OverlayCard
            theme={ov}
            variant={variant}
            showBrand
            nowPlaying={{
              ...SAMPLE,
              triggerWarning: previewTw ? 'graphic footage of the crash' : null,
            }}
            next={SAMPLE_NEXT}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save theme'}
        </Button>
        {saved && <span className="font-mono text-xs text-moss">Saved ✓</span>}
        {error && <span className="font-mono text-xs text-rust">{error}</span>}
        <button
          type="button"
          onClick={() => { setApp(DEFAULT_APP_THEME); setOv(DEFAULT_OVERLAY_THEME); }}
          className="ml-auto font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink"
        >
          Reset to Broadside defaults
        </button>
      </div>
      <p className="text-xs text-ink/50 mt-2">
        The overlay picks up a saved change within about 30 seconds — no need to touch the browser
        source in OBS, even mid-show.
      </p>
    </section>
  );
}
