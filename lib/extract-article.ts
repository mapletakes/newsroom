import { metaTag as meta, titleTag } from './html-meta';
import { safeFetchText } from './safe-fetch';

export type ArticleMeta = {
  title: string | null;
  description: string | null;
  thumbnail: string | null;
  publisher: string | null;
  author: string | null;
  publishedAt: string | null;
};

export async function extractArticle(url: string): Promise<ArticleMeta> {
  // This is the one extractor that fetches an arbitrary, unvalidated host —
  // article links come from chat with no allowlist of trusted domains, so
  // safeFetchText's SSRF guard and size cap apply here, not just a plain
  // fetch(). Article HTML is almost always well under a megabyte; 2MB
  // leaves generous room while still bounding memory against a server that
  // just keeps streaming.
  const { text: html } = await safeFetchText(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 10000,
  });

  const title =
    meta(html, 'og:title') ||
    meta(html, 'twitter:title') ||
    titleTag(html);

  const description =
    meta(html, 'og:description') ||
    meta(html, 'twitter:description') ||
    meta(html, 'description');

  const thumbnail =
    meta(html, 'og:image') ||
    meta(html, 'twitter:image');

  const publisher =
    meta(html, 'og:site_name') ||
    meta(html, 'article:publisher') ||
    new URL(url).hostname.replace(/^www\./, '');

  const author =
    meta(html, 'article:author') ||
    meta(html, 'author');

  const publishedAt =
    meta(html, 'article:published_time') ||
    meta(html, 'og:published_time');

  return { title, description, thumbnail, publisher, author, publishedAt };
}
