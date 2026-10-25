import { describe, expect, it, vi } from 'vitest';

vi.mock('./safe-fetch', () => ({ safeFetchText: vi.fn() }));

import { extractArticle } from './extract-article';
import { safeFetchText } from './safe-fetch';

function servePage(html: string) {
  vi.mocked(safeFetchText).mockResolvedValueOnce({ text: html, url: 'https://news.example.com/story' } as Awaited<ReturnType<typeof safeFetchText>>);
}

describe('extractArticle', () => {
  it('decodes entities in every field read from meta tags', async () => {
    servePage(`
      <html><head>
        <meta property="og:title" content="Q&amp;A: The Mayor&#8217;s &ldquo;Plan&rdquo;">
        <meta property="og:description" content="Taxes &amp; transit &mdash; explained">
        <meta property="og:image" content="https://cdn.example.com/img.jpg?w=1200&amp;h=630">
        <meta property="og:site_name" content="Smith &amp; Jones News">
        <meta name="author" content="Ana O&#039;Neil">
      </head></html>
    `);

    expect(await extractArticle('https://news.example.com/story')).toEqual({
      title: 'Q&A: The Mayor’s “Plan”',
      description: 'Taxes & transit — explained',
      thumbnail: 'https://cdn.example.com/img.jpg?w=1200&h=630',
      publisher: 'Smith & Jones News',
      author: "Ana O'Neil",
      publishedAt: null,
    });
  });

  it('decodes the <title> fallback when there are no OG tags', async () => {
    servePage('<html><head><title>Fish &amp; Chips &#8211; Review</title></head></html>');
    const meta = await extractArticle('https://www.example.com/review');
    expect(meta.title).toBe('Fish & Chips – Review');
    expect(meta.publisher).toBe('example.com');
  });
});
