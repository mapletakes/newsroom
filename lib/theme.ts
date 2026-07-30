// Per-stream theming: the shared vocabulary behind both the app's palette and
// the OBS overlay's.
//
// Two separate configs rather than one, because they answer to different
// masters. The app's palette has to stay legible for whoever is triaging links
// at 2am — so a streamer sets the default and anyone can override it locally.
// The overlay's job is the opposite: match a stream's branding exactly,
// against arbitrary footage, with nobody around to adjust it. That's why the
// overlay gets per-slot colours instead of inheriting the app's six tokens —
// "the warning bar's red" and "the app's rust" are genuinely different
// decisions once you're matching someone else's brand.
//
// Everything here is plain data + pure functions so it can be validated on the
// server, rendered on the server, and re-applied on the client from a poll
// payload without three copies of the rules.

// ── Colour helpers ────────────────────────────────────────────

/** #rgb / #rrggbb (any case, # optional) → normalised "#rrggbb", or null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return '#' + s.toLowerCase().split('').map((c) => c + c).join('');
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) return '#' + s.toLowerCase();
  return null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex) || '#000000';
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}

/** Tailwind's colour tokens are `rgb(var(--x) / <alpha-value>)`, so the custom
 *  properties hold a bare "R G B" triplet rather than a colour. */
export function hexToTriplet(hex: string): string {
  return hexToRgb(hex).join(' ');
}

/** Mix `amount` of `b` into `a`. Used for derived defaults (the "up next"
 *  strip's tint) so they don't need CSS color-mix, which isn't safe to assume
 *  in the embedded browser OBS ships. */
export function blend(a: string, b: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * amount);
  return (
    '#' +
    [m(r1, r2), m(g1, g2), m(b1, b2)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Relative luminance (WCAG). Used to pick readable defaults, and to warn in
 *  the settings UI when a chosen pair would be unreadable on stream. */
export function luminance(hex: string): number {
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/** WCAG contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ── Palettes ──────────────────────────────────────────────────

export const PALETTE_TOKENS = ['ink', 'paper', 'rust', 'ochre', 'moss', 'slate'] as const;
export type PaletteToken = (typeof PALETTE_TOKENS)[number];
export type Palette = Record<PaletteToken, string>;

/** The four built-ins, mirroring the `.theme-*` blocks in globals.css. Kept
 *  here as hex too so the overlay can resolve a preset into concrete slot
 *  colours without a stylesheet. */
export const PALETTES: Record<string, Palette> = {
  light: { ink: '#0d0d0e', paper: '#f5f1e8', rust: '#c4451c', ochre: '#d4a017', moss: '#3d5c3a', slate: '#2c3e50' },
  dark: { ink: '#e8e4db', paper: '#141416', rust: '#e8663e', ochre: '#e8b730', moss: '#5a8a55', slate: '#6b8faa' },
  sepia: { ink: '#2e2218', paper: '#f0e3ca', rust: '#a64a2c', ochre: '#b08026', moss: '#566038', slate: '#4a4858' },
  contrast: { ink: '#000000', paper: '#ffffff', rust: '#c6200c', ochre: '#966000', moss: '#006800', slate: '#00208c' },
};

export const PRESET_NAMES = Object.keys(PALETTES);
export const DEFAULT_PRESET = 'light';

// ── Fonts ─────────────────────────────────────────────────────

export type FontRole = 'display' | 'sans' | 'mono';

/** Fallback stacks per role — appended after whatever family is chosen so a
 *  font that fails to load still lands on something of the right shape. */
export const FONT_FALLBACK: Record<FontRole, string> = {
  display: 'Georgia, serif',
  sans: 'system-ui, sans-serif',
  mono: 'ui-monospace, monospace',
};

export const DEFAULT_FONTS: Record<FontRole, string> = {
  display: 'Fraunces',
  sans: 'IBM Plex Sans',
  mono: 'JetBrains Mono',
};

/** Curated pairings that suit the broadsheet look. Not a hard limit — the
 *  settings UI also takes a free-text Google family name — but these are the
 *  ones known to carry the design, so they're what's offered first. */
export const FONT_CHOICES: Record<FontRole, string[]> = {
  display: [
    'Fraunces',
    'Playfair Display',
    'Libre Baskerville',
    'Bitter',
    'Zilla Slab',
    'Bodoni Moda',
    'Oswald',
    'Anton',
    'Archivo Black',
    'Space Grotesk',
  ],
  sans: [
    'IBM Plex Sans',
    'Inter',
    'Work Sans',
    'Source Sans 3',
    'Barlow',
    'Archivo',
    'Public Sans',
    'Manrope',
  ],
  mono: [
    'JetBrains Mono',
    'IBM Plex Mono',
    'Space Mono',
    'Roboto Mono',
    'Source Code Pro',
    'DM Mono',
  ],
};

/**
 * Google family names only ever reach us as a string a streamer typed, and it
 * gets interpolated into both a stylesheet URL and a CSS font-family value —
 * so it's constrained to what a real family name can contain rather than
 * escaped after the fact. Anything with quotes, semicolons, or brackets is
 * rejected outright instead of being sanitised into something subtly wrong.
 */
export function sanitizeFontFamily(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/\s+/g, ' ');
  if (!s || s.length > 48) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 ]*$/.test(s)) return null;
  return s;
}

/** `font-family` value for a role: the chosen family plus its fallback stack. */
export function fontStack(family: string, role: FontRole): string {
  return `'${family}', ${FONT_FALLBACK[role]}`;
}

/**
 * Google Fonts css2 URL for the given families, deduped and sorted so the same
 * set always produces the same href (it's used as a cache key and as a React
 * key). Returns null when nothing needs loading.
 *
 * Weights are requested as a range where the family supports it; asking for
 * weights a family doesn't have makes Google 400 the whole request, so this
 * asks only for the safe common set and lets the browser synthesise the rest.
 */
export function googleFontsHref(families: string[]): string | null {
  const clean = Array.from(
    new Set(families.map((f) => sanitizeFontFamily(f)).filter((f): f is string => !!f)),
  ).sort();
  if (clean.length === 0) return null;
  const params = clean.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;700`);
  return `https://fonts.googleapis.com/css2?${params.join('&')}&display=swap`;
}

// ── App theme ─────────────────────────────────────────────────

export type AppTheme = {
  /** Which built-in palette the stream defaults to, or 'custom' to use `colors`. */
  preset: string;
  /** Only consulted when preset === 'custom'. */
  colors: Partial<Palette>;
  fonts: Partial<Record<FontRole, string>>;
};

export const DEFAULT_APP_THEME: AppTheme = { preset: DEFAULT_PRESET, colors: {}, fonts: {} };

/** True when the stream has actually customised anything — used to decide
 *  whether to push the brand theme onto viewers as their default at all. */
export function appThemeIsCustomised(t: AppTheme): boolean {
  return (
    t.preset !== DEFAULT_PRESET ||
    Object.keys(t.colors).length > 0 ||
    Object.keys(t.fonts).length > 0
  );
}

export function resolveAppPalette(t: AppTheme): Palette {
  const base = PALETTES[t.preset] || PALETTES[DEFAULT_PRESET];
  return { ...base, ...t.colors };
}

export function resolveFonts(fonts: Partial<Record<FontRole, string>>): Record<FontRole, string> {
  return {
    display: fonts.display || DEFAULT_FONTS.display,
    sans: fonts.sans || DEFAULT_FONTS.sans,
    mono: fonts.mono || DEFAULT_FONTS.mono,
  };
}

// ── Overlay theme ─────────────────────────────────────────────

/** Every colour the overlay paints, as its own decision. */
export const OVERLAY_SLOTS = [
  'cardBg',
  'cardText',
  'border',
  'accent',
  'warnBg',
  'warnText',
  'nextBg',
  'nextText',
] as const;
export type OverlaySlot = (typeof OVERLAY_SLOTS)[number];
export type OverlayColors = Record<OverlaySlot, string>;

export const OVERLAY_SLOT_LABELS: Record<OverlaySlot, string> = {
  cardBg: 'Card background',
  cardText: 'Headline & text',
  border: 'Border & shadow',
  accent: '“On air” accent',
  warnBg: 'Warning bar',
  warnText: 'Warning text',
  nextBg: '“Up next” strip',
  nextText: '“Up next” text',
};

export type OverlayTheme = {
  preset: string;
  colors: Partial<OverlayColors>;
  fonts: Partial<Record<'display' | 'mono', string>>;
  /** Drop the card's hard shadow — some layouts sit better flat. */
  flat: boolean;
};

export const DEFAULT_OVERLAY_THEME: OverlayTheme = {
  preset: DEFAULT_PRESET,
  colors: {},
  fonts: {},
  flat: false,
};

/**
 * Turn a preset into concrete slot colours. The two derived ones (the "up
 * next" strip) were previously `bg-ink/5` and `text-ink/70`; they're baked to
 * solid colours here so every slot is independently overridable — an alpha
 * tint can't be replaced by a flat brand colour.
 */
export function paletteToOverlayColors(p: Palette): OverlayColors {
  return {
    cardBg: p.paper,
    cardText: p.ink,
    border: p.ink,
    accent: p.rust,
    warnBg: p.rust,
    warnText: p.paper,
    nextBg: blend(p.paper, p.ink, 0.06),
    nextText: blend(p.ink, p.paper, 0.3),
  };
}

export function resolveOverlayColors(t: OverlayTheme): OverlayColors {
  const base = paletteToOverlayColors(PALETTES[t.preset] || PALETTES[DEFAULT_PRESET]);
  return { ...base, ...t.colors };
}

/**
 * The overlay's colours as inline custom properties. Inline rather than a
 * `.theme-*` class because these are per-stream values that change while the
 * source is live — the poll hands back a new theme and the card repaints,
 * with no stylesheet to swap.
 */
export function overlayCssVars(t: OverlayTheme): Record<string, string> {
  const c = resolveOverlayColors(t);
  const fonts = t.fonts;
  const vars: Record<string, string> = {};
  for (const slot of OVERLAY_SLOTS) vars[`--ov-${slot}`] = c[slot];
  // Kept as triplets as well so Tailwind's `/opacity` syntax still works for
  // the few places the card wants a translucent rule.
  vars['--ov-cardText-rgb'] = hexToTriplet(c.cardText);
  vars['--ov-border-rgb'] = hexToTriplet(c.border);
  vars['--ov-font-display'] = fontStack(fonts.display || DEFAULT_FONTS.display, 'display');
  vars['--ov-font-mono'] = fontStack(fonts.mono || DEFAULT_FONTS.mono, 'mono');
  return vars;
}

/** Families the overlay needs loaded for a given theme. */
export function overlayFontFamilies(t: OverlayTheme): string[] {
  return [t.fonts.display || DEFAULT_FONTS.display, t.fonts.mono || DEFAULT_FONTS.mono];
}

// ── Validation (server-side; these come off the wire) ─────────

function pickColors<K extends string>(raw: unknown, keys: readonly K[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of keys) {
    const hex = normalizeHex((raw as Record<string, unknown>)[k]);
    if (hex) out[k] = hex;
  }
  return out;
}

function pickFonts<K extends string>(raw: unknown, roles: readonly K[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const r of roles) {
    const fam = sanitizeFontFamily((raw as Record<string, unknown>)[r]);
    if (fam) out[r] = fam;
  }
  return out;
}

function pickPreset(raw: unknown, allowCustom: boolean): string {
  const s = typeof raw === 'string' ? raw : '';
  if (allowCustom && s === 'custom') return 'custom';
  return PRESET_NAMES.includes(s) ? s : DEFAULT_PRESET;
}

/** Anything unrecognised is dropped rather than rejected — a stored theme
 *  written by an older or newer build should degrade to defaults, not 400. */
export function sanitizeAppTheme(raw: unknown): AppTheme {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    preset: pickPreset(o.preset, true),
    colors: pickColors(o.colors, PALETTE_TOKENS),
    fonts: pickFonts(o.fonts, ['display', 'sans', 'mono'] as const),
  };
}

export function sanitizeOverlayTheme(raw: unknown): OverlayTheme {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    preset: pickPreset(o.preset, false),
    colors: pickColors(o.colors, OVERLAY_SLOTS),
    fonts: pickFonts(o.fonts, ['display', 'mono'] as const),
    flat: o.flat === true,
  };
}
