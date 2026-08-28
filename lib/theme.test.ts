// Theme values arrive as whatever a streamer typed into a settings form and
// end up interpolated into a stylesheet URL, a CSS font-family, and a set of
// custom properties written straight into a <style> tag. The sanitizers are
// the only thing between those two facts, so they're what's covered hardest
// here.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCENT_HUES,
  ACCENT_HUES_COLORBLIND,
  appThemeCssVars,
  blend,
  contrastRatio,
  DEFAULT_FONTS,
  DEFAULT_RECIPE,
  deriveAccent,
  derivePalette,
  DEFAULT_PRESET,
  FONT_CHOICES,
  googleFontsHref,
  hexToTriplet,
  MIN_TEXT_CONTRAST,
  normalizeHex,
  OVERLAY_SLOTS,
  overlayCssVars,
  PALETTE_TOKENS,
  PALETTES,
  paletteContrastFailures,
  paletteToOverlayColors,
  RECIPE_LIMITS,
  resolveOverlayColors,
  sanitizeRecipe,
  SELF_HOSTED_FONTS,
  sanitizeAppTheme,
  sanitizeFontFamily,
  sanitizeOverlayTheme,
  TEXT_SAFE_TOKENS,
  type PaletteRecipe,
  type PaletteToken,
} from './theme';

describe('normalizeHex', () => {
  it('accepts 3- and 6-digit hex with or without a hash, any case', () => {
    expect(normalizeHex('#FFF')).toBe('#ffffff');
    expect(normalizeHex('abc')).toBe('#aabbcc');
    expect(normalizeHex('#C4451C')).toBe('#c4451c');
    expect(normalizeHex('  #c4451c  ')).toBe('#c4451c');
  });

  it('rejects anything that is not a hex colour', () => {
    for (const bad of ['', 'red', '#12', '#12345', '#1234567', 'rgb(1,2,3)', null, 42, {}]) {
      expect(normalizeHex(bad)).toBeNull();
    }
  });

  // A CSS value is being built from this; a colour that smuggles a brace or a
  // semicolon through would escape the declaration it's written into.
  it('rejects attempts to break out of the declaration', () => {
    expect(normalizeHex('#fff;}html{display:none')).toBeNull();
    expect(normalizeHex('fff}')).toBeNull();
    expect(normalizeHex('#ff0000/**/')).toBeNull();
  });
});

describe('hexToTriplet', () => {
  it('produces the bare "R G B" Tailwind expects behind rgb(var(--x))', () => {
    expect(hexToTriplet('#000000')).toBe('0 0 0');
    expect(hexToTriplet('#ffffff')).toBe('255 255 255');
    expect(hexToTriplet('#c4451c')).toBe('196 69 28');
  });

  it('matches the values globals.css declares for the built-in palettes', () => {
    expect(hexToTriplet(PALETTES.light.ink)).toBe('13 13 14');
    expect(hexToTriplet(PALETTES.light.paper)).toBe('245 241 232');
    expect(hexToTriplet(PALETTES.dark.paper)).toBe('20 20 22');
    expect(hexToTriplet(PALETTES.contrast.slate)).toBe('0 32 140');
  });
});

describe('blend', () => {
  it('interpolates between two colours', () => {
    expect(blend('#000000', '#ffffff', 0)).toBe('#000000');
    expect(blend('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(blend('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('contrastRatio', () => {
  it('spans the full WCAG range', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });

  // The warning bar sets its text at 40px black and its label at 20px bold,
  // both comfortably "large" by WCAG (>=18.66px bold), where AA asks 3.0
  // rather than 4.5 — which is why the settings UI grades overlay slots
  // against the threshold for the size they actually paint, while the app
  // palette below is held to the stricter body-text bar throughout.
  it('rates the shipped warning bar as readable at the size it renders', () => {
    const c = paletteToOverlayColors(PALETTES.light);
    expect(contrastRatio(c.warnBg, c.warnText)).toBeGreaterThan(3);
  });

  it('rates every built-in palette readable for card text on card background', () => {
    for (const name of Object.keys(PALETTES)) {
      const c = paletteToOverlayColors(PALETTES[name]);
      expect(contrastRatio(c.cardBg, c.cardText), name).toBeGreaterThan(4.5);
    }
  });
});

// The guarantee that lets the app ship a palette picker at all: a streamer
// choosing a built-in should never be able to land on one that renders risk
// warnings or status labels illegibly. Every one of these caught a real
// shipped bug when first written — light's ochre was at 2.11:1 behind the
// "◐ medium DMCA risk" label on the DEFAULT theme.
describe('built-in palette accessibility', () => {
  it('has no token below the body-text bar, in any shipped palette', () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      const failures = paletteContrastFailures(palette);
      expect(
        failures,
        // Named in the failure message so a future palette edit says exactly
        // which token broke and by how much, rather than just "expected []".
        `${name}: ${failures.map((f) => `${f.token} ${f.ratio.toFixed(2)}:1`).join(', ')}`,
      ).toEqual([]);
    }
  });

  it('grades every token except paper — paper IS the background', () => {
    expect(TEXT_SAFE_TOKENS).not.toContain('paper');
    // Guards against a token being added to the palette and silently escaping
    // the check above.
    expect([...TEXT_SAFE_TOKENS].sort()).toEqual(
      PALETTE_TOKENS.filter((t) => t !== 'paper').slice().sort(),
    );
  });

  it('reports the offending token and its real ratio, not just a boolean', () => {
    // A deliberately broken palette: pale yellow text on cream.
    const broken = { ...PALETTES.light, rust: '#f7e9a0' };
    const failures = paletteContrastFailures(broken);
    expect(failures).toHaveLength(1);
    expect(failures[0].token).toBe('rust');
    expect(failures[0].ratio).toBeLessThan(MIN_TEXT_CONTRAST);
  });

  it('accepts a colour sitting exactly at the threshold, not just above it', () => {
    // Boundary check — the comparison is `< threshold`, so a colour graded at
    // precisely the bar must be usable rather than rejected. Every token is
    // set to the same value here so one exact ratio covers all of them.
    const p = PALETTES.light;
    const uniform = Object.fromEntries(
      PALETTE_TOKENS.map((t) => [t, t === 'paper' ? p.paper : p.ink]),
    ) as typeof p;
    expect(paletteContrastFailures(uniform, contrastRatio(p.ink, p.paper))).toEqual([]);
  });
});

// PALETTES and the `.theme-*` blocks in globals.css are the same four
// palettes written twice, and they have to be: the stylesheet needs literal
// values to paint with, while PALETTES is what the settings preview and the
// overlay compute from. Nothing but this test stops the two halves drifting —
// and they did, the first time these values were edited, which left the CSS
// (what actually paints) still carrying the inaccessible originals.
// The guided palette builder's entire promise is that a streamer cannot
// produce a broken palette — which only means anything if it holds at the
// edges of every control, not just at the defaults.
describe('derivePalette', () => {
  it('holds the semantic hues fixed so risk stays red / amber / green', () => {
    // A palette free to rotate these could quietly render "high DMCA risk"
    // in green, which is the one thing this whole system exists to prevent.
    expect(ACCENT_HUES.rust).toBeLessThan(ACCENT_HUES.ochre);
    expect(ACCENT_HUES.ochre).toBeLessThan(ACCENT_HUES.moss);
    expect(ACCENT_HUES.moss).toBeLessThan(ACCENT_HUES.slate);
  });

  it('produces a full palette with every token set', () => {
    const p = derivePalette(DEFAULT_RECIPE);
    for (const token of PALETTE_TOKENS) {
      expect(p[token], token).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('never emits a failing palette, across every reachable recipe', () => {
    // Swept from RECIPE_LIMITS rather than hardcoded bounds, because those
    // limits are what the sanitizer clamps to — widening a slider without
    // re-proving the wider space would otherwise leave the guarantee quietly
    // covering less than the UI can reach. Exhaustive rather than sampled:
    // an accessibility guarantee with gaps in it isn't one.
    const { hue: H, tint: T, sat: S } = RECIPE_LIMITS;
    let checked = 0;
    for (const ground of ['light', 'dark'] as const) {
      for (let hue = H.min; hue <= H.max; hue += 15) {
        for (let tint = T.min; tint <= T.max; tint += 0.02) {
          for (let sat = S.min; sat <= S.max; sat += 0.05) {
            const p = derivePalette({ ground, hue, tint, sat });
            const failures = paletteContrastFailures(p);
            expect(failures, `${ground} hue${hue} tint${tint.toFixed(2)} sat${sat.toFixed(2)}`).toEqual([]);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('lands the accents in a tight band, not merely above the floor', () => {
    // The point of solving toward a target: green and yellow clear 4.5:1 far
    // more easily than red, so "first passing value" yields a neon green
    // beside a muted red. Every accent should carry similar visual weight.
    const p = derivePalette(DEFAULT_RECIPE);
    const ratios = (['rust', 'ochre', 'moss', 'slate'] as const).map((t) => contrastRatio(p[t], p.paper));
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(1);
  });

  it('gives light and dark grounds genuinely different papers', () => {
    const light = derivePalette({ ...DEFAULT_RECIPE, ground: 'light' });
    const dark = derivePalette({ ...DEFAULT_RECIPE, ground: 'dark' });
    expect(contrastRatio(light.paper, dark.paper)).toBeGreaterThan(10);
  });
});

describe('sanitizeRecipe', () => {
  it('clamps every field into the space the sweep above actually proves', () => {
    const r = sanitizeRecipe({ ground: 'dark', hue: 9999, tint: 5, sat: 1 })!;
    expect(r.hue).toBe(RECIPE_LIMITS.hue.max);
    expect(r.tint).toBe(RECIPE_LIMITS.tint.max);
    expect(r.sat).toBe(RECIPE_LIMITS.sat.max);
    // The clamp is the only thing standing between a hand-posted recipe and
    // an untested corner of the space, so it must also hold below the floor.
    const low = sanitizeRecipe({ ground: 'light', hue: -50, tint: -1, sat: 0 })!;
    expect(low.hue).toBe(RECIPE_LIMITS.hue.min);
    expect(low.tint).toBe(RECIPE_LIMITS.tint.min);
    expect(low.sat).toBe(RECIPE_LIMITS.sat.min);
  });

  it('rejects anything without a usable ground rather than inventing one', () => {
    for (const bad of [null, undefined, 42, 'light', {}, { ground: 'beige' }]) {
      expect(sanitizeRecipe(bad)).toBeUndefined();
    }
  });

  it('substitutes the default for non-numeric fields, keeping the recipe usable', () => {
    const r = sanitizeRecipe({ ground: 'light', hue: 'blue', tint: null, sat: NaN })!;
    expect(r).toEqual({ ground: 'light', ...{ hue: DEFAULT_RECIPE.hue, tint: DEFAULT_RECIPE.tint, sat: DEFAULT_RECIPE.sat } });
  });

  it('survives a round trip through sanitizeAppTheme', () => {
    const recipe = { ground: 'dark' as const, hue: 300, tint: 0.1, sat: 0.5 };
    expect(sanitizeAppTheme({ preset: 'custom', recipe }).recipe).toEqual(recipe);
  });

  it('drops a bad recipe without discarding the colours that still render', () => {
    // A custom theme saved before the builder existed has colours and no
    // recipe; it has to keep working exactly as it did.
    const t = sanitizeAppTheme({ preset: 'custom', colors: { ink: '#111111' }, recipe: 'nonsense' });
    expect(t.recipe).toBeUndefined();
    expect(t.colors.ink).toBe('#111111');
  });
});

describe('the generated built-ins came from the engine', () => {
  // Broadsheet / Midnight / Ash have a hand-chosen ground but engine-derived
  // accents, and are stored as literals because globals.css needs the same
  // values written out. Pinning the saturation each was generated at means a
  // retune of deriveAccent shows up here as a failure — a decision to make
  // deliberately, rather than something to notice later in a screenshot.
  it.each([
    ['broadsheet', 0.6],
    ['midnight', 0.58],
    ['ash', 0.42],
  ])('%s accents are exactly what deriveAccent gives for its paper', (name, sat) => {
    const { paper } = PALETTES[name];
    for (const [token, hue] of Object.entries(ACCENT_HUES)) {
      expect(deriveAccent(hue, sat, paper), `${name}.${token}`).toBe(PALETTES[name][token as PaletteToken]);
    }
  });

  it('colorblind is the exact output of derivePalette with ACCENT_HUES_COLORBLIND', () => {
    // Whole-palette check, not just the accents — paper and ink are engine
    // output here too, unlike broadsheet/midnight/ash which chose those two
    // by hand and only derived the accents.
    const recipe: PaletteRecipe = { ground: 'light', hue: 40, tint: 0.05, sat: 0.62 };
    expect(derivePalette(recipe, ACCENT_HUES_COLORBLIND)).toEqual(PALETTES.colorblind);
  });
});

describe('ACCENT_HUES_COLORBLIND', () => {
  const hueDiff = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

  it('moves moss out of the hue range that collapses under red-green colour blindness', () => {
    // Protanopia/deuteranopia confound the red-green opponent channel, which
    // is what makes roughly 0-70 degrees (red through orange) hard to tell
    // apart from roughly 90-150 (green). rust sits in the first band in
    // BOTH hue sets (that's alert — it's meant to read as red/orange); what
    // has to change is keeping moss out of the second one.
    const inDangerBand = (h: number) => h >= 90 && h <= 150;
    expect(inDangerBand(ACCENT_HUES.moss)).toBe(true);
    expect(inDangerBand(ACCENT_HUES_COLORBLIND.moss)).toBe(false);
  });

  it('separates rust from moss by more than the standard hue set does', () => {
    const before = hueDiff(ACCENT_HUES.rust, ACCENT_HUES.moss);
    const after = hueDiff(ACCENT_HUES_COLORBLIND.rust, ACCENT_HUES_COLORBLIND.moss);
    expect(after).toBeGreaterThan(before);
  });

  it('keeps ochre and slate close to the standard set — amber and blue were never the problem', () => {
    // Only moss needed to move meaningfully; changing hues that were already
    // fine would just make the colorblind palette look arbitrarily different
    // rather than specifically fixed.
    expect(hueDiff(ACCENT_HUES.ochre, ACCENT_HUES_COLORBLIND.ochre)).toBeLessThan(5);
    expect(hueDiff(ACCENT_HUES.slate, ACCENT_HUES_COLORBLIND.slate)).toBeLessThan(15);
  });

  it('still guarantees every token, across the same swept recipe space', () => {
    const { hue: H, tint: T, sat: S } = RECIPE_LIMITS;
    let checked = 0;
    for (const ground of ['light', 'dark'] as const) {
      for (let hue = H.min; hue <= H.max; hue += 30) {
        for (let tint = T.min; tint <= T.max; tint += 0.04) {
          for (let sat = S.min; sat <= S.max; sat += 0.1) {
            const p = derivePalette({ ground, hue, tint, sat }, ACCENT_HUES_COLORBLIND);
            expect(paletteContrastFailures(p), `${ground} hue${hue} tint${tint.toFixed(2)} sat${sat.toFixed(2)}`).toEqual([]);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe('globals.css mirrors PALETTES', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../app/globals.css'), 'utf8');

  /** Pull `--token: r g b;` declarations out of one `.theme-*` block. */
  function paletteFromCss(themeClass: string): Record<string, string> {
    const block = new RegExp(`\\.${themeClass}\\s*\\{([^}]*)\\}`).exec(css);
    if (!block) throw new Error(`no .${themeClass} block found in globals.css`);
    const out: Record<string, string> = {};
    for (const [, token, r, g, b] of block[1].matchAll(/--(\w+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
      out[token] = '#' + [r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    }
    return out;
  }

  for (const name of Object.keys(PALETTES)) {
    it(`${name} matches, token for token`, () => {
      expect(paletteFromCss(`theme-${name}`)).toEqual(PALETTES[name]);
    });
  }
});

describe('sanitizeFontFamily', () => {
  it('accepts real Google family names', () => {
    expect(sanitizeFontFamily('Fraunces')).toBe('Fraunces');
    expect(sanitizeFontFamily('IBM Plex Sans')).toBe('IBM Plex Sans');
    expect(sanitizeFontFamily('Source Sans 3')).toBe('Source Sans 3');
    expect(sanitizeFontFamily('  Space   Mono  ')).toBe('Space Mono');
  });

  // The name is interpolated into `'<name>', fallback` and into a URL, so a
  // quote or a semicolon would break out of both.
  it('rejects names that could escape a CSS value or a URL', () => {
    for (const bad of [
      "Fraunces', sans-serif; }html{display:none",
      'Fraunces"',
      'Fraunces;',
      'Frau)nces',
      'url(evil)',
      '<script>',
      'Fraunces\\',
      '../../etc',
    ]) {
      expect(sanitizeFontFamily(bad)).toBeNull();
    }
  });

  it('rejects empty, absurdly long, and non-string input', () => {
    expect(sanitizeFontFamily('')).toBeNull();
    expect(sanitizeFontFamily('   ')).toBeNull();
    expect(sanitizeFontFamily('A'.repeat(49))).toBeNull();
    expect(sanitizeFontFamily(null)).toBeNull();
    expect(sanitizeFontFamily(123)).toBeNull();
  });
});

describe('googleFontsHref', () => {
  it('builds one request for the whole set, deduped and order-independent', () => {
    const a = googleFontsHref(['Inter', 'Fraunces', 'Inter']);
    const b = googleFontsHref(['Fraunces', 'Inter']);
    expect(a).toBe(b);
    expect(a).toContain('family=Fraunces');
    expect(a).toContain('family=Inter');
    expect(a!.startsWith('https://fonts.googleapis.com/css2?')).toBe(true);
  });

  it('encodes spaces the way the css2 API expects', () => {
    expect(googleFontsHref(['IBM Plex Sans'])).toContain('family=IBM+Plex+Sans');
  });

  it('drops families that fail sanitising, and returns null if none survive', () => {
    expect(googleFontsHref(["Evil'; }"])).toBeNull();
    expect(googleFontsHref([])).toBeNull();
    expect(googleFontsHref(['Inter', "Evil'; }"])).toBe(googleFontsHref(['Inter']));
  });

  // The real bug this guards: Google 400s a css2 request that names a family
  // it doesn't host at all, not just one with an unsupported weight — and a
  // combined request means that ONE bad family can take the whole request
  // down, including every real Google font asked for alongside it.
  describe('self-hosted fonts (OpenDyslexic)', () => {
    it('never appears in the built URL on its own', () => {
      expect(googleFontsHref(['OpenDyslexic'])).toBeNull();
    });

    it('is dropped from a combined request without breaking the other, real families', () => {
      const withIt = googleFontsHref(['Inter', 'OpenDyslexic', 'Fraunces']);
      const withoutIt = googleFontsHref(['Inter', 'Fraunces']);
      expect(withIt).toBe(withoutIt);
      expect(withIt).toContain('family=Inter');
      expect(withIt).toContain('family=Fraunces');
      expect(withIt).not.toContain('OpenDyslexic');
    });

    it('covers every family SELF_HOSTED_FONTS actually lists, not just the one known today', () => {
      for (const f of SELF_HOSTED_FONTS) {
        expect(googleFontsHref([f])).toBeNull();
      }
    });
  });
});

describe('FONT_CHOICES', () => {
  it('offers OpenDyslexic in every role — this is an accessibility choice, not a display-only flourish', () => {
    for (const role of Object.keys(FONT_CHOICES) as (keyof typeof FONT_CHOICES)[]) {
      expect(FONT_CHOICES[role]).toContain('OpenDyslexic');
    }
  });

  it('never offers a self-hosted font that googleFontsHref would still try to fetch', () => {
    // The invariant that actually matters: whatever's self-hosted per
    // SELF_HOSTED_FONTS must be excluded by googleFontsHref, so nothing in
    // FONT_CHOICES can silently regress into a broken combined request.
    for (const role of Object.keys(FONT_CHOICES) as (keyof typeof FONT_CHOICES)[]) {
      for (const f of FONT_CHOICES[role]) {
        if (SELF_HOSTED_FONTS.includes(f)) {
          expect(googleFontsHref([f, 'Inter'])).toBe(googleFontsHref(['Inter']));
        }
      }
    }
  });
});

describe('sanitizeAppTheme', () => {
  it('falls back to defaults for junk input', () => {
    for (const junk of [null, undefined, 'nope', 42, []]) {
      expect(sanitizeAppTheme(junk)).toEqual({ preset: DEFAULT_PRESET, colors: {}, fonts: {} });
    }
  });

  it('keeps recognised presets and rejects invented ones', () => {
    expect(sanitizeAppTheme({ preset: 'dark' }).preset).toBe('dark');
    expect(sanitizeAppTheme({ preset: 'custom' }).preset).toBe('custom');
    expect(sanitizeAppTheme({ preset: 'neon' }).preset).toBe(DEFAULT_PRESET);
  });

  it('keeps only known colour tokens, normalised', () => {
    const t = sanitizeAppTheme({ colors: { ink: '#FFF', bogus: '#000', paper: 'nope' } });
    expect(t.colors).toEqual({ ink: '#ffffff' });
  });

  it('keeps only known font roles, sanitised', () => {
    const t = sanitizeAppTheme({ fonts: { display: 'Inter', mono: "bad'", weird: 'Inter' } });
    expect(t.fonts).toEqual({ display: 'Inter' });
  });
});

describe('sanitizeOverlayTheme', () => {
  it('has no "custom" preset — every slot is overridable on its own', () => {
    expect(sanitizeOverlayTheme({ preset: 'custom' }).preset).toBe(DEFAULT_PRESET);
    expect(sanitizeOverlayTheme({ preset: 'sepia' }).preset).toBe('sepia');
  });

  it('keeps only known slots and coerces flat to a boolean', () => {
    const t = sanitizeOverlayTheme({
      colors: { warnBg: '#00FF00', nope: '#fff' },
      flat: 'yes',
    });
    expect(t.colors).toEqual({ warnBg: '#00ff00' });
    expect(t.flat).toBe(false);
    expect(sanitizeOverlayTheme({ flat: true }).flat).toBe(true);
  });
});

describe('resolveOverlayColors', () => {
  it('fills every slot from the preset when nothing is overridden', () => {
    const c = resolveOverlayColors(sanitizeOverlayTheme({ preset: 'dark' }));
    for (const slot of OVERLAY_SLOTS) expect(c[slot]).toMatch(/^#[0-9a-f]{6}$/);
    expect(c.cardBg).toBe(PALETTES.dark.paper);
    expect(c.accent).toBe(PALETTES.dark.rust);
  });

  it('lets a single slot be restyled without disturbing the rest', () => {
    const base = resolveOverlayColors(sanitizeOverlayTheme({ preset: 'light' }));
    const c = resolveOverlayColors(
      sanitizeOverlayTheme({ preset: 'light', colors: { warnBg: '#7a00ff' } }),
    );
    expect(c.warnBg).toBe('#7a00ff');
    expect(c.accent).toBe(base.accent); // the app's rust is a separate decision
    expect(c.cardBg).toBe(base.cardBg);
  });
});

describe('overlayCssVars', () => {
  it('emits a property per slot plus the rgb triplets and font stacks', () => {
    const vars = overlayCssVars(sanitizeOverlayTheme({ preset: 'light' }));
    for (const slot of OVERLAY_SLOTS) expect(vars[`--ov-${slot}`]).toMatch(/^#[0-9a-f]{6}$/);
    expect(vars['--ov-cardText-rgb']).toBe('13 13 14');
    expect(vars['--ov-font-display']).toContain(DEFAULT_FONTS.display);
    expect(vars['--ov-font-mono']).toContain(DEFAULT_FONTS.mono);
  });

  it('quotes a chosen family so a multi-word name stays one family', () => {
    const vars = overlayCssVars(sanitizeOverlayTheme({ fonts: { display: 'Playfair Display' } }));
    expect(vars['--ov-font-display']).toBe("'Playfair Display', Georgia, serif");
  });

  // Everything here is written into a style attribute; nothing may contain a
  // character that could terminate a declaration.
  it('never emits a value containing a brace, semicolon or quote-escape', () => {
    const vars = overlayCssVars(
      sanitizeOverlayTheme({
        colors: { warnBg: '#fff;}html{display:none' },
        fonts: { display: "Evil', x; }" },
      }),
    );
    for (const v of Object.values(vars)) {
      expect(v).not.toMatch(/[{}]/);
      expect(v.replace(/'/g, '')).not.toContain(';');
    }
  });
});

describe('appThemeCssVars', () => {
  it('emits a triplet per palette token plus the three font stacks', () => {
    const vars = appThemeCssVars(sanitizeAppTheme({ preset: 'light' }));
    for (const token of PALETTE_TOKENS) expect(vars[`--${token}`]).toMatch(/^\d+ \d+ \d+$/);
    expect(vars['--ink']).toBe('13 13 14');
    expect(vars['--font-display']).toContain(DEFAULT_FONTS.display);
    expect(vars['--font-sans']).toContain(DEFAULT_FONTS.sans);
    expect(vars['--font-mono']).toContain(DEFAULT_FONTS.mono);
  });

  it('quotes a chosen family so a multi-word name stays one family', () => {
    const vars = appThemeCssVars(sanitizeAppTheme({ fonts: { sans: 'Source Sans 3' } }));
    expect(vars['--font-sans']).toBe("'Source Sans 3', system-ui, sans-serif");
  });

  it('reflects a custom colour override, not just the preset', () => {
    const vars = appThemeCssVars(sanitizeAppTheme({ preset: 'custom', colors: { ink: '#ff0000' } }));
    expect(vars['--ink']).toBe('255 0 0');
  });

  // StreamTheme.tsx splits this object's keys apart (palette -> html.brand,
  // fonts -> :root) by destructuring the three font keys out by name — if
  // this function ever emitted the font vars under different keys, that
  // split would silently start leaking a font var into the palette-only
  // block instead of raising a type error.
  it('exposes exactly the font keys StreamTheme.tsx destructures by name, and nothing else besides the six palette tokens', () => {
    const vars = appThemeCssVars(sanitizeAppTheme({ preset: 'light' }));
    const fontKeys = ['--font-display', '--font-sans', '--font-mono'];
    const paletteKeys = PALETTE_TOKENS.map((t) => `--${t}`);
    expect(Object.keys(vars).sort()).toEqual([...fontKeys, ...paletteKeys].sort());
  });

  // Same contract as overlayCssVars — this also lands in a style attribute.
  it('never emits a value containing a brace, semicolon or quote-escape', () => {
    const vars = appThemeCssVars(
      sanitizeAppTheme({
        preset: 'custom',
        colors: { ink: '#fff;}html{display:none' },
        fonts: { display: "Evil', x; }" },
      }),
    );
    for (const v of Object.values(vars)) {
      expect(v).not.toMatch(/[{}]/);
      expect(v.replace(/'/g, '')).not.toContain(';');
    }
  });
});
