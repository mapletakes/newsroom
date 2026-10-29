import { describe, expect, it } from 'vitest';
import {
  faceRank,
  pickFontSrc,
  pruneStylesheets,
  scriptFamilyUnused,
  selectorCanMatch,
  unicodeRangeUsed,
  type DocTokens,
} from './archive-css';

const cps = (s: string) => new Set([...s].map((c) => c.codePointAt(0)!));
const doc: DocTokens = {
  classes: new Set(['text-[1.625rem]', 'md:text-[2rem]', 'a', 'w-1/2', 'headline']),
  ids: new Set(['main']),
  tags: new Set(['html', 'body', 'div', 'h1', 'p']),
  codepoints: cps('Hello world'),
};

describe('selectorCanMatch', () => {
  it.each([
    ['.text-\\[1\\.625rem\\]', true],
    ['.md\\:text-\\[2rem\\]', true],
    ['.md\\:text-\\[3rem\\]', false],
    ['.w-1\\/2', true],
    ['div.a:hover > p::before', true],
    ['.a:not(.missing)', true],
    ['.missing', false],
    ['h1[data-x="a.b"]', true],
    ['section .a', false],
    ['#main .a', true],
    ['#nope', false],
    // A class only scripts add can never appear in a frozen page.
    ['html.js .a', false],
    [':is(.missing, .a) p', true],
    ['&.a', true],
  ])('%s → %s', (sel, want) => {
    expect(selectorCanMatch(sel, doc)).toBe(want);
  });
});

describe('pruneStylesheets', () => {
  it('drops rules nothing on the page can match, and emptied @media blocks', () => {
    const [out] = pruneStylesheets(['.a{color:red}.missing{color:blue}@media (min-width:1px){.gone{x:y}}'], doc);
    expect(out).toContain('.a{color:red}');
    expect(out).not.toContain('missing');
    expect(out).not.toContain('@media');
  });

  it('keeps a font declared in one sheet and used in another', () => {
    const fonts = '@font-face{font-family:"Brand Serif";src:url(a.woff2) format("woff2")}';
    const usage = '.headline{font-family:"Brand Serif",Georgia,serif}';
    const [f] = pruneStylesheets([fonts, usage], doc);
    expect(f).toContain('Brand Serif');
  });

  it('drops fonts no kept rule uses', () => {
    const [out] = pruneStylesheets(['@font-face{font-family:Unused;src:url(u.woff2)}.a{font-family:Other}'], doc);
    expect(out).not.toContain('Unused');
  });

  it('keeps one source per face, preferring woff2', () => {
    const [out] = pruneStylesheets(
      ['@font-face{font-family:F;src:url(f.eot),url(f.woff) format("woff"),url(f.woff2) format("woff2")}.a{font-family:F}'],
      doc,
    );
    expect(out).toContain('f.woff2');
    expect(out).not.toContain('f.woff"');
    expect(out).not.toContain('f.eot');
  });

  it('keeps only the last src declaration of a face', () => {
    const [out] = pruneStylesheets(
      ['@font-face{font-family:F;src:url(f.eot);src:url(f.eot?#iefix) format("embedded-opentype"),url(f.woff2) format("woff2")}.a{font-family:F}'],
      doc,
    );
    expect(out).toContain('f.woff2');
    expect(out).not.toContain('f.eot');
  });

  it('keeps at most four faces per family, regular and bold first', () => {
    const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
    const faces = weights.map((w) => `@font-face{font-family:F;font-weight:${w};src:url(f${w}.woff2)}`).join('');
    const [out] = pruneStylesheets([`${faces}.a{font-family:F}`], doc);
    expect(out.match(/@font-face/g)).toHaveLength(4);
    expect(out).toContain('f400.woff2');
    expect(out).toContain('f700.woff2');
  });

  it('drops unicode-range subsets and script fonts the text never uses', () => {
    const css =
      '@font-face{font-family:F;unicode-range:U+0400-04FF;src:url(cyr.woff2)}' +
      '@font-face{font-family:F;unicode-range:U+0000-00FF;src:url(latin.woff2)}' +
      '@font-face{font-family:"Noto Sans Arabic";src:url(ar.woff2)}' +
      '.a{font-family:F,"Noto Sans Arabic"}';
    const [out] = pruneStylesheets([css], doc);
    expect(out).toContain('latin.woff2');
    expect(out).not.toContain('cyr.woff2');
    expect(out).not.toContain('ar.woff2');
  });

  it('keeps only the last of identical faces, which is the one browsers use', () => {
    const css =
      '@font-face{font-family:F;src:url(old.woff2)}@font-face{font-family:F;src:url(new.woff2)}.a{font-family:F}';
    const [out] = pruneStylesheets([css], doc);
    expect(out).toContain('new.woff2');
    expect(out).not.toContain('old.woff2');
  });

  it('counts families named as var() fallbacks, and keeps local()-only faces', () => {
    const css =
      '@font-face{font-family:Adjusted;src:url(adj.woff2)}' +
      '@font-face{font-family:LocalOnly;src:local("Arial")}' +
      '.a{font-family:var(--brand-font,"Adjusted")}';
    const [out] = pruneStylesheets([css], doc);
    expect(out).toContain('adj.woff2');
    expect(out).toContain('LocalOnly');
  });

  it('returns unparseable CSS unchanged', () => {
    const broken = '.a{color:red';
    expect(pruneStylesheets([broken], doc)[0]).toBe(broken);
  });
});

describe('font helpers', () => {
  it('parses unicode ranges, including wildcards', () => {
    expect(unicodeRangeUsed('U+0000-00FF', cps('a'))).toBe(true);
    expect(unicodeRangeUsed('U+4??', cps('a'))).toBe(false);
    expect(unicodeRangeUsed('U+4??', cps('А'))).toBe(true);
  });

  it('recognises script-specific families only when the text lacks that script', () => {
    expect(scriptFamilyUnused('noto_sans_arabic', cps('Hello'))).toBe(true);
    expect(scriptFamilyUnused('noto_sans_arabic', cps('مرحبا'))).toBe(false);
    expect(scriptFamilyUnused('georgia', cps('Hello'))).toBe(false);
  });

  it('ranks regular, then bold, upright before italic, variable faces first', () => {
    expect(faceRank('400', 'normal')).toBeLessThan(faceRank('700', 'normal'));
    expect(faceRank('700', 'normal')).toBeLessThan(faceRank('400', 'italic'));
    expect(faceRank('200 900', 'normal')).toBeLessThan(faceRank('400', 'normal'));
  });

  it('keeps local() fallbacks alongside the chosen url', () => {
    expect(pickFontSrc('local("F"), url(f.woff) format("woff"), url(f.woff2) format("woff2")')).toBe(
      'local("F"), url(f.woff2) format("woff2")',
    );
  });
});
