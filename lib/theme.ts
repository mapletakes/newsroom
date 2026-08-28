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

/** HSL (h in turns, s/l in 0..1) → "#rrggbb". Needed because palettes are
 *  DERIVED by holding a hue steady and moving lightness — an operation with
 *  no sane expression in RGB. */
export function hslToHex(h: number, s: number, l: number): string {
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
  return (
    '#' +
    rgb
      .map((c) => Math.round(Math.min(255, Math.max(0, c * 255))).toString(16).padStart(2, '0'))
      .join('')
  );
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

/**
 * Every token except `paper` renders as body-size TEXT on `paper` somewhere:
 * `ink` is all body copy, and each accent has at least one text role —
 * `rust` (.dmca-high, ⚠ badges, `text-rust` in 150+ places), `ochre`
 * (.dmca-medium, the "Partial" mod status, admin pending states), `moss`
 * (.dmca-low, "Saved ✓"), `slate` (`text-slate`).
 *
 * That makes text-safety a property of the PALETTE, not of any one call
 * site, which is what `paletteContrastFailures` below exists to enforce.
 * Accents therefore have to be chosen dark enough (on light paper) to read
 * as text — they can't also be tuned as saturated fills. Where one is used
 * as a fill it's either an alpha tint (`bg-ochre/10`) or a small non-text
 * indicator, both of which stay legible at a text-safe value; `::selection`
 * in globals.css is tinted for exactly this reason.
 */
export const TEXT_SAFE_TOKENS = PALETTE_TOKENS.filter((t) => t !== 'paper');

/** WCAG AA for body-size text. The app has no large-text-only palette role,
 *  so this is the single bar every token above is held to. */
export const MIN_TEXT_CONTRAST = 4.5;

/**
 * Which tokens in a palette would be illegible as text on its own paper.
 * Empty means the palette is safe.
 *
 * Deliberately a plain function over a Palette rather than a check baked
 * into the settings UI: it backs both the build-time guarantee that every
 * SHIPPED palette passes (lib/theme.test.ts) and the live feedback a
 * streamer gets while building one of their own, so the two can't drift
 * into disagreeing about what "accessible" means.
 */
export function paletteContrastFailures(
  p: Palette,
  threshold = MIN_TEXT_CONTRAST,
): { token: PaletteToken; ratio: number }[] {
  const failures: { token: PaletteToken; ratio: number }[] = [];
  for (const token of TEXT_SAFE_TOKENS) {
    const ratio = contrastRatio(p[token], p.paper);
    if (ratio < threshold) failures.push({ token, ratio });
  }
  return failures;
}

/** The four built-ins, mirroring the `.theme-*` blocks in globals.css. Kept
 *  here as hex too so the overlay can resolve a preset into concrete slot
 *  colours without a stylesheet.
 *
 *  Every value here is covered by the contrast test — see the note on
 *  TEXT_SAFE_TOKENS. Three were adjusted when that test was added and
 *  caught them: light's rust (4.42:1) and ochre (2.11:1), and sepia's ochre
 *  (2.78:1). The ochres in particular had been picked as bright highlight
 *  golds, which simply cannot carry small text on cream paper — the
 *  replacements hold the same hue and saturation and only drop lightness
 *  until they clear the bar. */
export const PALETTES: Record<string, Palette> = {
  light: { ink: '#0d0d0e', paper: '#f5f1e8', rust: '#c0431b', ochre: '#8a680f', moss: '#3d5c3a', slate: '#2c3e50' },
  dark: { ink: '#e8e4db', paper: '#141416', rust: '#e8663e', ochre: '#e8b730', moss: '#5a8a55', slate: '#6b8faa' },
  sepia: { ink: '#2e2218', paper: '#f0e3ca', rust: '#a64a2c', ochre: '#825e1c', moss: '#566038', slate: '#4a4858' },
  contrast: { ink: '#000000', paper: '#ffffff', rust: '#c6200c', ochre: '#966000', moss: '#006800', slate: '#00208c' },
  // Generated by derivePalette below rather than picked by eye, which is why
  // their accents sit in a tight 5.4–5.6:1 band where the four hand-built
  // palettes above range from 4.5:1 to 9.9:1. Kept as literals, not computed
  // at import: globals.css needs the same values written out for the
  // stylesheet, and a test holds the two copies together.
  broadsheet: { ink: '#11161c', paper: '#eef1f4', rust: '#9f4428', ochre: '#765c1e', moss: '#1c6e1e', slate: '#2a60a7' },
  midnight: { ink: '#dde4ec', paper: '#0f131a', rust: '#d16f52', ochre: '#ad872e', moss: '#2ba12f', slate: '#5a8ed3' },
  ash: { ink: '#e4e2dd', paper: '#1a1a1c', rust: '#c27f6b', ochre: '#aa8c46', moss: '#43a346', slate: '#6e93c4' },
};

/** Display name and picker glyph per palette. Lives here beside PALETTES so
 *  adding one is a single edit — the theme menu, the settings picker and
 *  next-themes' registered class list all read from this rather than keeping
 *  their own hand-maintained copies of the same list, which is how a palette
 *  used to end up half-added. */
export const PALETTE_META: Record<string, { label: string; icon: string }> = {
  light: { label: 'Newsprint', icon: 'themeLight' },
  dark: { label: 'Dark', icon: 'themeDark' },
  sepia: { label: 'Sepia', icon: 'themeSepia' },
  contrast: { label: 'High contrast', icon: 'themeContrast' },
  broadsheet: { label: 'Broadsheet', icon: 'themeBroadsheet' },
  midnight: { label: 'Midnight', icon: 'themeMidnight' },
  ash: { label: 'Ash', icon: 'themeAsh' },
};

export const PRESET_NAMES = Object.keys(PALETTES);
export const DEFAULT_PRESET = 'light';

// ── Palette derivation ────────────────────────────────────────
//
// Builds a whole palette from a handful of choices, guaranteeing every token
// clears MIN_TEXT_CONTRAST. This is what the settings UI offers in place of
// six free colour pickers: those let a streamer produce a palette that fails
// the very bar the built-ins are held to, which is how the default theme
// ended up shipping an ochre at 2.11:1.
//
// The four accent HUES never move. Alert is red, highlight amber, success
// green, info blue, in every palette anyone can build — because those three
// risk colours encode DMCA high/medium/low, and a palette free to rotate them
// could quietly turn "high risk" green. What a streamer does control is the
// ground (light or dark), its temperature, how strongly that tint shows, and
// how vivid the accents are, which is enough range to separate a warm cream
// newsroom from a cool blue-black one.

export const ACCENT_HUES: Record<Exclude<PaletteToken, 'ink' | 'paper'>, number> = {
  rust: 14,
  ochre: 42,
  moss: 122,
  slate: 214,
};

/** Contrast the derived accents aim for. Above the 4.5 floor on purpose: a
 *  hue solved to land exactly on the floor is legible but visually weaker
 *  than its neighbours, and the four should read as one family. */
export const ACCENT_TARGET_CONTRAST = 5.5;

export type PaletteRecipe = {
  ground: 'light' | 'dark';
  /** Degrees, 0–360. Tints both paper and ink. */
  hue: number;
  /** 0–1. How much of `hue` shows in the ground. */
  tint: number;
  /** 0–1. Accent saturation. */
  sat: number;
};

/**
 * The bounds of the guided builder — and the reason they're a shared constant
 * rather than three numbers typed into a slider.
 *
 * "No recipe can produce an inaccessible palette" is proven by a test that
 * sweeps this exact space. That proof only covers what it swept, so the UI
 * and the sanitizer have to be held to the same bounds: a slider that let
 * `sat` past 0.85, or a hand-posted recipe that skipped the clamp, would be
 * outside everything anyone has actually checked.
 */
export const RECIPE_LIMITS = {
  hue: { min: 0, max: 360 },
  tint: { min: 0, max: 0.14 },
  sat: { min: 0.2, max: 0.85 },
} as const;

export const DEFAULT_RECIPE: PaletteRecipe = { ground: 'light', hue: 210, tint: 0.04, sat: 0.6 };

/** Clamp an off-the-wire recipe into RECIPE_LIMITS, or reject it outright.
 *  Returns undefined rather than a default for anything unrecognisable, so a
 *  theme with no usable recipe simply has no recipe — the palette it already
 *  stores still renders. */
export function sanitizeRecipe(raw: unknown): PaletteRecipe | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (o.ground !== 'light' && o.ground !== 'dark') return undefined;
  const clamp = (v: unknown, { min, max }: { min: number; max: number }, fallback: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    ground: o.ground,
    hue: clamp(o.hue, RECIPE_LIMITS.hue, DEFAULT_RECIPE.hue),
    tint: clamp(o.tint, RECIPE_LIMITS.tint, DEFAULT_RECIPE.tint),
    sat: clamp(o.sat, RECIPE_LIMITS.sat, DEFAULT_RECIPE.sat),
  };
}

/**
 * The most on-target lightness for `hue` against `paper`, never below `min`.
 *
 * Solving toward a target rather than taking the first passing value is what
 * keeps a palette even: green and yellow clear 4.5:1 far more easily than red
 * or blue, so a first-passing search returns a neon green sitting next to a
 * muted red — which is exactly the unevenness visible in the hand-built
 * palettes (dark's ochre at 9.85:1 beside its moss at 4.56:1).
 */
export function deriveAccent(
  hueDeg: number,
  sat: number,
  paper: string,
  target = ACCENT_TARGET_CONTRAST,
  min = MIN_TEXT_CONTRAST,
): string | null {
  let best: string | null = null;
  let bestErr = Infinity;
  for (let i = 0; i <= 100; i++) {
    const hex = hslToHex(hueDeg / 360, sat, i / 100);
    const ratio = contrastRatio(hex, paper);
    if (ratio < min) continue;
    const err = Math.abs(ratio - target);
    if (err < bestErr) {
      bestErr = err;
      best = hex;
    }
  }
  return best;
}

/** A complete, contrast-guaranteed palette from a recipe. */
export function derivePalette(recipe: PaletteRecipe): Palette {
  const { ground, hue, tint, sat } = recipe;
  const light = ground === 'light';
  const paper = hslToHex(hue / 360, tint, light ? 0.955 : 0.075);
  // Ink carries the same hue at half strength — a pure neutral against a
  // tinted ground reads as an oversight rather than a decision.
  const ink = hslToHex(hue / 360, tint * 0.5, light ? 0.07 : 0.9);
  const out = { ink, paper } as Palette;
  for (const [token, hueDeg] of Object.entries(ACCENT_HUES)) {
    // Falls back to ink, which is by construction the most legible colour
    // available on this paper. Unreachable for any recipe the UI can produce
    // (every combination is covered by a test), but a silent `null` leaking
    // into a stylesheet would be far worse than a dull-but-readable accent.
    out[token as PaletteToken] = deriveAccent(hueDeg, sat, paper) ?? ink;
  }
  return out;
}

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

/** Not on Google Fonts, so it can't go through the runtime-fetch path every
 *  other choice here does — see the @font-face block in app/globals.css,
 *  where it's self-hosted and always available instead. googleFontsHref
 *  below excludes anything in this list for exactly that reason: Google
 *  400s a css2 request that names a family it doesn't host, which would
 *  otherwise take down every OTHER font requested in the same call. */
export const SELF_HOSTED_FONTS: readonly string[] = ['OpenDyslexic'];

/** Curated pairings that suit the broadsheet look. Not a hard limit — the
 *  settings UI also takes a free-text Google family name — but these are the
 *  ones known to carry the design, so they're what's offered first.
 *
 *  OpenDyslexic is listed in all three roles rather than just `sans`: it's
 *  an accessibility choice, not a stylistic one, and someone picking it is
 *  almost always trying to make everything they read easier, not just body
 *  copy while headlines and labels stay in whatever was already there. */
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
    'OpenDyslexic',
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
    'OpenDyslexic',
  ],
  mono: [
    'JetBrains Mono',
    'IBM Plex Mono',
    'Space Mono',
    'Roboto Mono',
    'Source Code Pro',
    'DM Mono',
    'OpenDyslexic',
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
 * SELF_HOSTED_FONTS is filtered out for the identical reason — a family
 * Google doesn't host at all fails the same way a bad weight does, and a
 * theme that pairs OpenDyslexic with a real Google font for another role
 * must not have that real font break too.
 */
export function googleFontsHref(families: string[]): string | null {
  const clean = Array.from(
    new Set(
      families
        .map((f) => sanitizeFontFamily(f))
        .filter((f): f is string => !!f && !SELF_HOSTED_FONTS.includes(f)),
    ),
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
  /**
   * The guided-builder settings that produced `colors`, when a custom palette
   * came from the builder rather than the older free-form colour pickers.
   *
   * Purely a record of the inputs so re-opening the editor can restore where
   * the controls were — `colors` stays the single source of truth for what
   * actually renders. That split is deliberate: it keeps the rendering path
   * identical for custom palettes saved before the builder existed (which
   * have colours and no recipe), and it means retuning the derivation later
   * can never silently repaint a theme somebody already approved.
   */
  recipe?: PaletteRecipe;
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

/**
 * The app theme's palette and fonts as inline custom properties — the
 * `--ink`/`--paper`/etc. triplets tailwind.config's colour scale reads via
 * `rgb(var(--ink) / <alpha-value>)`, plus the three `--font-*` stacks.
 *
 * Pulled out of components/StreamTheme.tsx (which used to build this same
 * object inline, string-by-string) so there's exactly one place that knows
 * how an AppTheme becomes CSS — the settings page's live preview (see
 * AppThemeSettings) needs the identical mapping, scoped to a wrapper div
 * instead of written into a server-rendered <style> tag, and a second
 * hand-rolled copy is exactly how the two would eventually drift.
 */
export function appThemeCssVars(t: AppTheme): Record<string, string> {
  const palette = resolveAppPalette(t);
  const fonts = resolveFonts(t.fonts);
  const vars: Record<string, string> = {};
  for (const token of PALETTE_TOKENS) vars[`--${token}`] = hexToTriplet(palette[token]);
  vars['--font-display'] = fontStack(fonts.display, 'display');
  vars['--font-sans'] = fontStack(fonts.sans, 'sans');
  vars['--font-mono'] = fontStack(fonts.mono, 'mono');
  return vars;
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
  const recipe = sanitizeRecipe(o.recipe);
  return {
    preset: pickPreset(o.preset, true),
    colors: pickColors(o.colors, PALETTE_TOKENS),
    fonts: pickFonts(o.fonts, ['display', 'sans', 'mono'] as const),
    // Omitted entirely when absent or unusable, rather than defaulted — an
    // AppTheme carrying a recipe it was never built from would put the
    // editor's controls somewhere its colours don't correspond to.
    ...(recipe ? { recipe } : {}),
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
