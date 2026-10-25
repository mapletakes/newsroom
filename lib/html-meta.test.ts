import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities, metaTag, titleTag } from './html-meta';

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

  it('keeps the other quote character inside the value', () => {
    expect(metaTag(`<meta property="og:title" content="it's here">`, 'og:title')).toBe("it's here");
    expect(metaTag(`<meta content='say "hi"' property='og:title'>`, 'og:title')).toBe('say "hi"');
  });

  it('returns null when the tag is absent', () => {
    expect(metaTag('<html><head></head></html>', 'og:title')).toBeNull();
  });

  it('is not fooled by an unrelated meta property sharing a prefix', () => {
    const html = '<meta property="og:title:extra" content="wrong">';
    expect(metaTag(html, 'og:title')).toBeNull();
  });

  it('decodes entities in the value', () => {
    expect(metaTag('<meta property="og:title" content="Q&amp;A: it&#8217;s &quot;fine&quot;">', 'og:title'))
      .toBe('Q&A: it\u2019s "fine"');
  });

  it('decodes &amp; in a URL so the query string survives', () => {
    const html = '<meta property="og:image" content="https://cdn.example.com/i.jpg?w=1200&amp;h=630&amp;sig=abc">';
    expect(metaTag(html, 'og:image')).toBe('https://cdn.example.com/i.jpg?w=1200&h=630&sig=abc');
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

  it('decodes entities, including a non-breaking space that then trims away', () => {
    expect(titleTag('<title>Fish &amp; Chips &mdash; Review&nbsp;</title>')).toBe('Fish & Chips \u2014 Review');
  });

  it('returns null for an empty title (whitespace-only trims to nothing)', () => {
    expect(titleTag('<title>   </title>')).toBeNull();
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeHtmlEntities('a &amp; b &quot;c&quot; &#064;d &#x2022; &#039;e')).toBe('a & b "c" @d • \'e');
  });

  it('decodes the typographic named entities headlines use', () => {
    expect(decodeHtmlEntities('&lsquo;a&rsquo; &ldquo;b&rdquo; c&ndash;d&mdash;e&hellip;'))
      .toBe('\u2018a\u2019 \u201cb\u201d c\u2013d\u2014e\u2026');
  });

  it('decodes only once, so a double-escaped entity stays literal text', () => {
    expect(decodeHtmlEntities('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
  });

  it('leaves unknown or malformed entities untouched', () => {
    expect(decodeHtmlEntities('&bogus; &#xZZ; 5 & 6')).toBe('&bogus; &#xZZ; 5 & 6');
  });
});
