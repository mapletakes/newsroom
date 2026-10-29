import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { findEmbeddedArticle, injectRecovered, isArticlePage, paywalledSelectors } from './archive-recover';

const para = (i: number) => `Paragraph number ${i} of the story, long enough to count as real prose in an article body.`;
const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const nextData = (o: unknown) =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(o).padEnd(2500)}</script>`;

function page(head: string, body: string) {
  return cheerio.load(`<html><head>${head}</head><body>${body}</body></html>`, { scriptingEnabled: false });
}

describe('findEmbeddedArticle', () => {
  it('reads a ProseMirror-style body tree from page data (Bloomberg)', () => {
    const body = {
      type: 'document',
      content: Array.from({ length: 6 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', value: para(i) }] })),
    };
    const $ = page(
      ld({ '@type': 'NewsArticle' }) + nextData({ props: { pageProps: { story: { body, aiSummary: { text: ['short'] } } } } }),
      '',
    );
    expect(findEmbeddedArticle($)).toEqual({ source: 'page-data', paragraphs: Array.from({ length: 6 }, (_, i) => para(i)) });
  });

  it('reads Arc XP content_elements and skips non-prose blocks', () => {
    const content_elements = [
      { type: 'text', content: `<p>${para(0)}</p>` },
      { type: 'image', url: 'https://example.com/a.jpg', caption: 'A long caption that should not be treated as body text at all.' },
      { type: 'text', content: para(1) },
      { type: 'text', content: para(2) },
    ];
    const $ = page(nextData({ props: { pageProps: { globalContent: { content_elements } } } }), '');
    expect(findEmbeddedArticle($)?.paragraphs).toEqual([para(0), para(1), para(2)]);
  });

  it('falls back to JSON-LD articleBody', () => {
    const $ = page(ld({ '@type': 'NewsArticle', articleBody: [para(0), para(1)].join('\n') }), '');
    expect(findEmbeddedArticle($)).toEqual({ source: 'json-ld', paragraphs: [para(0), para(1)] });
  });
});

describe('isArticlePage / paywalledSelectors', () => {
  it('recognises articles by og:type or JSON-LD type', () => {
    expect(isArticlePage(page('<meta property="og:type" content="article">', ''))).toBe(true);
    expect(isArticlePage(page(ld({ '@graph': [{ '@type': 'ReportageNewsArticle' }] }), ''))).toBe(true);
    expect(isArticlePage(page(ld({ '@type': 'WebPage' }), ''))).toBe(false);
  });

  it('reads Google paywall markup', () => {
    const $ = page(
      ld({
        '@type': 'NewsArticle',
        isAccessibleForFree: false,
        hasPart: { '@type': 'WebPageElement', isAccessibleForFree: false, cssSelector: '.paywall' },
      }),
      '',
    );
    expect(paywalledSelectors($)).toEqual(['.paywall']);
  });
});

describe('injectRecovered', () => {
  const rec = { source: 'page-data' as const, paragraphs: Array.from({ length: 8 }, (_, i) => para(i)) };

  it('appends only the missing paragraphs after the last visible one, with a note', () => {
    const $ = page('', `<article><h1>T</h1><p>${para(0)}</p><p>${para(1)}</p><aside>Related</aside></article>`);
    expect(injectRecovered($, rec)).toBe(6);
    const texts = $('article p').toArray().map((p) => $(p).text());
    expect(texts).toEqual(rec.paragraphs);
    expect($('[data-broadside-recovered]').text()).toContain('recovered from data embedded in the page');
  });

  it('leaves a page that already shows the article untouched', () => {
    const $ = page('', `<article>${rec.paragraphs.map((p) => `<p>${p}</p>`).join('')}</article>`);
    expect(injectRecovered($, rec)).toBe(0);
    expect($('[data-broadside-recovered]').length).toBe(0);
  });

  it('escapes recovered text', () => {
    const $ = page('', '<article><p>Short intro paragraph that is visible on the page already, mostly.</p></article>');
    injectRecovered($, {
      source: 'json-ld',
      paragraphs: [`<img src=x onerror=alert(1)> ${para(1)}`, para(2), para(3), para(4), para(5), para(6), para(7)],
    });
    expect($('article img').length).toBe(0);
  });
});
