'use client';

import { useEffect, useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { OverlayCard, type OverlayVariant } from '@/app/overlay/OverlayView';
import { SubmissionCard, type Submission } from '@/components/SubmissionCard';
import {
  appThemeCssVars,
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

// Fixed rather than `new Date()`: this is a module-level constant, so a
// live timestamp would be computed once during the server render and again,
// a moment later, during client hydration — two different instants React
// then has to paper over as a hydration mismatch. AppThemeSettings swaps in
// the real "now" itself, client-side only, after mount (see `previewNow`
// below), which sidesteps that entirely rather than just hiding it.
const PREVIEW_FALLBACK_DATE = '2026-01-01T12:00:00.000Z';

// Deliberately touches all three accent colours at once — dmca-medium
// (ochre) on the risk badge, a trigger warning (rust), archive_url set so
// ArchiveButton renders its already-archived state (moss) — plus all three
// font roles (headline/body/mono), so one card is enough to judge a whole
// palette-and-type pairing rather than needing several partial ones.
const SAMPLE_SUBMISSION: Submission = {
  id: 'preview',
  url: 'https://example.com/preview',
  kind: 'article',
  status: 'approved',
  title: 'Senate passes surprise budget bill in 3am vote',
  thumbnail_url: null,
  publisher: 'Reuters',
  author: null,
  duration_seconds: 347,
  published_at: PREVIEW_FALLBACK_DATE,
  description: null,
  summary:
    'A short standfirst summarising the piece, set in the body typeface — this is the paragraph text a mod actually reads while triaging.',
  credibility_tag: 'Mixed',
  topics: ['congress', 'budget'],
  dmca_risk: 'medium',
  content_warning: null,
  related_coverage: null,
  archive_url: '#preview',
  mod_notes: null,
  prep_note: null,
  trigger_warning: 'brief description of graphic content',
  segment_id: null,
  position: 0,
  submitter_login: 'a_viewer',
  submitter_is_sub: true,
  submitter_is_mod: false,
  submitter_is_vip: false,
  created_at: PREVIEW_FALLBACK_DATE,
};

// ── Small field components ────────────────────────────────────

function ColorField({
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
function useThemeSave(endpoint = '/api/setup') {
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

function SaveRow({
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

// ── App palette + type ────────────────────────────────────────

export function AppThemeSettings({
  initial,
  endpoint = '/api/setup',
  intro,
  saveNote = "The page reloads on save — the app's palette is applied server-side, so that's what makes it show up.",
}: {
  initial: AppTheme;
  /** Where to POST. /api/setup writes the channel brand; /api/prefs writes
   *  the signed-in person's own theme. */
  endpoint?: string;
  intro?: React.ReactNode;
  saveNote?: string;
}) {
  const [app, setApp] = useState<AppTheme>(initial);
  const { save, saving, saved, error } = useThemeSave(endpoint);

  // The preview's timestamps start at PREVIEW_FALLBACK_DATE (matching what
  // the server rendered) and only become "now" after mount — a plain
  // `new Date()` in render would compute two different instants for the
  // server pass and the client hydration pass, which is exactly what a
  // hydration-mismatch warning is for.
  const [previewNow, setPreviewNow] = useState<string | null>(null);
  useEffect(() => setPreviewNow(new Date().toISOString()), []);
  const palette = resolveAppPalette(app);

  return (
    <section>
      <p className="text-sm text-ink/70 mb-6 max-w-prose leading-relaxed">
        {intro ?? (
          <>
            How the deck, mod view, and shelf look. This is a <strong>default</strong>, not a rule — a
            mod who finds another palette easier to read can still switch, and keeps that choice.
            Viewers never see any of this; the on-air look lives under <strong>Overlay</strong>.
          </>
        )}
      </p>

      <h3 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">Palette</h3>
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6 p-3 border border-ink/20">
          {PALETTE_TOKENS.map((t) => (
            <ColorField
              key={t}
              label={TOKEN_LABELS[t]}
              value={palette[t]}
              // Everything here is read at body size, so this is the one place
              // the strict 4.5 threshold is the right bar.
              against={t === 'paper' ? palette.ink : palette.paper}
              onChange={(hex) => setApp({ ...app, colors: { ...app.colors, [t]: hex } })}
            />
          ))}
        </div>
      )}

      <h3 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">Type</h3>
      <div className="grid sm:grid-cols-3 gap-3">
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

      <h3 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-2 mt-6">Preview</h3>
      {/* Scoped to this box alone via inline custom properties, not the page's
          real theme — the whole point is judging a change before committing
          to it, so picking a bad palette here can't actually apply it. Real
          AppHeader and SubmissionCard, real sample data, same reasoning as
          the overlay preview below reusing OverlayCard: a lookalike mockup
          drifts from what the deck actually renders the first time either
          one changes. The header earns its place here specifically — a
          palette reads differently in a thin nav bar than it does on a full
          card, and "what does my masthead look like" was the one thing a
          card alone could never answer. */}
      <div
        className="border border-ink/20 pointer-events-none select-none overflow-hidden"
        style={appThemeCssVars(app) as React.CSSProperties}
      >
        <AppHeader
          className="bg-paper text-ink border-b-2 border-ink px-4 py-3 gap-4"
          section="deck"
          right={
            <>
              <span className="uppercase tracking-widest text-ink/60">#yourchannel</span>
              {/* Styled to match the real header's nav links, but a plain
                  span rather than a Link — nothing in a preview should be
                  navigable, and pointer-events-none only stops clicks, not
                  Next's own prefetch-on-visible behaviour for a real Link. */}
              <span className="underline">Shelf</span>
            </>
          }
        />
        <div className="bg-paper text-ink font-sans p-3">
          <SubmissionCard
            s={previewNow ? { ...SAMPLE_SUBMISSION, created_at: previewNow, published_at: previewNow } : SAMPLE_SUBMISSION}
          />
        </div>
      </div>

      <SaveRow
        saving={saving}
        saved={saved}
        error={error}
        onSave={() => save({ app_theme: app }, true)}
        onReset={() => setApp(DEFAULT_APP_THEME)}
        note={saveNote}
      />
    </section>
  );
}

// ── Overlay palette + type ────────────────────────────────────

export function OverlayThemeSettings({ initial }: { initial: OverlayTheme }) {
  const [ov, setOv] = useState<OverlayTheme>(initial);
  const [variant, setVariant] = useState<OverlayVariant>('default');
  const [previewTw, setPreviewTw] = useState(true);
  const { save, saving, saved, error } = useThemeSave();
  const colors = resolveOverlayColors(ov);

  return (
    <section>
      <h3 className="font-display text-xl font-bold mb-1">Colours &amp; type</h3>
      <p className="text-xs text-ink/60 mb-4 max-w-prose">
        What your viewers see. Unlike the app theme this applies exactly as set — there&apos;s
        nobody at the browser source to adjust it.
      </p>

      <div className="mb-3 flex flex-wrap gap-2 items-center">
        <ToggleGroup
          type="single"
          value={ov.preset}
          onValueChange={(v) => { if (v) setOv({ ...ov, preset: v, colors: {} }); }}
          className="text-[10px]"
          aria-label="Overlay palette starting point"
        >
          {PRESET_LABELS.map(([value, label]) => (
            <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="font-mono text-[10px] text-ink/40">starting point — tweak anything below</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 p-3 border border-ink/20">
        {OVERLAY_SLOTS.map((slot) => (
          <ColorField
            key={slot}
            label={OVERLAY_SLOT_LABELS[slot]}
            value={colors[slot]}
            against={CONTRAST_PAIR[slot] ? colors[CONTRAST_PAIR[slot]!] : undefined}
            // The overlay's type is large and bold, where WCAG asks 3.0 rather
            // than 4.5 — grading it at body strictness would flag perfectly
            // legible pairings, including the one we ship.
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

      <label className="flex items-center gap-2 mb-6 cursor-pointer">
        <input type="checkbox" checked={ov.flat} onChange={(e) => setOv({ ...ov, flat: e.target.checked })} />
        <span className="font-mono text-xs">Flat card (no drop shadow)</span>
      </label>

      <h3 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">Preview</h3>
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
          flat paper hides exactly the problem worth catching, which is a card
          that vanishes into the streamer's own footage. */}
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
            nowPlaying={{ ...SAMPLE, triggerWarning: previewTw ? 'graphic footage of the crash' : null }}
            next={SAMPLE_NEXT}
          />
        </div>
      </div>

      <SaveRow
        saving={saving}
        saved={saved}
        error={error}
        onSave={() => save({ overlay_theme: ov }, false)}
        onReset={() => setOv(DEFAULT_OVERLAY_THEME)}
        note="A live browser source picks this up within about 30 seconds — no need to touch OBS, even mid-show."
      />
    </section>
  );
}
