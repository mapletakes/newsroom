import { describe, expect, it } from 'vitest';
import { MAX_TITLE_OVERRIDE_CHARS, normalizeTitleOverride, resolveTitle } from './title-override';

describe('normalizeTitleOverride', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeTitleOverride('  A better title  ')).toBe('A better title');
  });

  it('treats blank, whitespace-only, null and non-strings as "no override"', () => {
    expect(normalizeTitleOverride('')).toBeNull();
    expect(normalizeTitleOverride('   ')).toBeNull();
    expect(normalizeTitleOverride(null)).toBeNull();
    expect(normalizeTitleOverride(undefined)).toBeNull();
    expect(normalizeTitleOverride(42)).toBeNull();
  });

  it('caps length, and re-trims so a cut never leaves trailing whitespace', () => {
    const long = 'x'.repeat(MAX_TITLE_OVERRIDE_CHARS + 50);
    expect(normalizeTitleOverride(long)).toHaveLength(MAX_TITLE_OVERRIDE_CHARS);

    const cutOnSpace = 'x'.repeat(MAX_TITLE_OVERRIDE_CHARS - 1) + ' tail';
    expect(normalizeTitleOverride(cutOnSpace)).toBe('x'.repeat(MAX_TITLE_OVERRIDE_CHARS - 1));
  });
});

describe('resolveTitle', () => {
  it('prefers the override over the scraped title', () => {
    expect(resolveTitle({ title: 'Scraped', title_override: 'Mine' })).toBe('Mine');
  });

  it('falls back to the scraped title when there is no override', () => {
    expect(resolveTitle({ title: 'Scraped', title_override: null })).toBe('Scraped');
    expect(resolveTitle({ title: 'Scraped' })).toBe('Scraped');
  });

  it('ignores a whitespace-only override rather than showing a blank title', () => {
    expect(resolveTitle({ title: 'Scraped', title_override: '   ' })).toBe('Scraped');
  });

  it('returns null when there is neither, so each surface can fall back to the url itself', () => {
    expect(resolveTitle({ title: null, title_override: null })).toBeNull();
  });
});
