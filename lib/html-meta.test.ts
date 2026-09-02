import { describe, expect, it } from 'vitest';
import { metaTag, titleTag } from './html-meta';

describe('metaTag', () => {
  it('matches property="x" content="y" order', () => {
    const html = '<meta property="og:title" content="Hello World">';
    expect(metaTag(html, 'og:title')).toBe('Hello World');
  });

  it('matches name="x" content="y" order', () => {
    const html = '<meta name="description" content="A page about things">';
    expect(metaTag(html, 'description')).toBe('A page about things');
  });

  it('matches content before property/name (attribute order can vary)', () => {
    const html = '<meta content="Reversed order" property="og:description">';
    expect(metaTag(html, 'og:description')).toBe('Reversed order');
  });

  it('handles single quotes', () => {
    const html = "<meta property='og:title' content='Single quoted'>";
    expect(metaTag(html, 'og:title')).toBe('Single quoted');
  });

  it('returns null when the tag is absent', () => {
    expect(metaTag('<html><head></head></html>', 'og:title')).toBeNull();
  });

  it('is not fooled by an unrelated meta property sharing a prefix', () => {
    const html = '<meta property="og:title:extra" content="wrong">';
    expect(metaTag(html, 'og:title')).toBeNull();
  });

  it('finds the right tag among several', () => {
    const html = `
      <meta property="og:site_name" content="Example News">
      <meta property="og:title" content="The Real Title">
      <meta property="og:image" content="https://example.com/thumb.jpg">
    `;
    expect(metaTag(html, 'og:title')).toBe('The Real Title');
  });
});

describe('titleTag', () => {
  it('extracts and trims the <title> content', () => {
    expect(titleTag('<title>  Page Title  </title>')).toBe('Page Title');
  });

  it('returns null when there is no title tag', () => {
    expect(titleTag('<html><head></head></html>')).toBeNull();
  });

  it('returns null for an empty title (whitespace-only trims to nothing)', () => {
    expect(titleTag('<title>   </title>')).toBeNull();
  });
});
