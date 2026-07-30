// Theme values arrive as whatever a streamer typed into a settings form and
// end up interpolated into a stylesheet URL, a CSS font-family, and a set of
// custom properties written straight into a <style> tag. The sanitizers are
// the only thing between those two facts, so they're what's covered hardest
// here.

import { describe, expect, it } from 'vitest';
import {
  blend,
  contrastRatio,
  DEFAULT_FONTS,
  DEFAULT_PRESET,
  googleFontsHref,
  hexToTriplet,
  normalizeHex,
  OVERLAY_SLOTS,
  overlayCssVars,
  PALETTES,
  paletteToOverlayColors,
  resolveOverlayColors,
  sanitizeAppTheme,
  sanitizeFontFamily,
  sanitizeOverlayTheme,
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
  // rather than 4.5. The shipped rust-on-paper pair sits at ~4.4: fine as
  // rendered, but it is NOT a pairing to reuse at body size, which is why the
  // settings UI grades against the threshold for the size it actually paints.
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
