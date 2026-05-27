import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export type ArticleMeta = {
  title: string | null;
  description: string | null;
  thumbnail: string | null;
  publisher: string | null;
  author: string | null;
  publishedAt: string | null;
  textContent: string | null; // first ~6000 chars of body
};

function metaContent(doc: Document, name: string): string | null {
  const el =
    doc.querySelector(`meta[property="${name}"]`) ||
    doc.querySelector(`meta[name="${name}"]`);
  return el?.getAttribute('content') || null;
}

export async function extractArticle(url: string): Promise<ArticleMeta> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NewsroomBot/0.1; +https://newsroom.app)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    // 10s timeout via AbortSignal
    signal: AbortSignal.timeout(10000),
  });
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  const title =
    metaContent(doc, 'og:title') ||
    metaContent(doc, 'twitter:title') ||
    doc.querySelector('title')?.textContent ||
    null;

  const description =
    metaContent(doc, 'og:description') ||
    metaContent(doc, 'twitter:description') ||
    metaContent(doc, 'description') ||
    null;

  const thumbnail =
    metaContent(doc, 'og:image') ||
    metaContent(doc, 'twitter:image') ||
    null;

  const publisher =
    metaContent(doc, 'og:site_name') ||
    metaContent(doc, 'article:publisher') ||
    new URL(url).hostname.replace(/^www\./, '');

  const author =
    metaContent(doc, 'article:author') ||
    metaContent(doc, 'author') ||
    null;

  const publishedAt =
    metaContent(doc, 'article:published_time') ||
    metaContent(doc, 'og:published_time') ||
    null;

  // Body text via Readability
  let textContent: string | null = null;
  try {
    const reader = new Readability(doc.cloneNode(true) as Document);
    const article = reader.parse();
    if (article?.textContent) {
      textContent = article.textContent.trim().slice(0, 6000);
    }
  } catch {
    // ignore parse failures
  }

  return { title, description, thumbnail, publisher, author, publishedAt, textContent };
}
