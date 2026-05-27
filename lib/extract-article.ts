export type ArticleMeta = {
  title: string | null;
  description: string | null;
  thumbnail: string | null;
  publisher: string | null;
  author: string | null;
  publishedAt: string | null;
};

function meta(html: string, name: string): string | null {
  // Match <meta property="name" content="..."> or <meta name="name" content="...">
  // Also handles content before property/name and single quotes
  const re = new RegExp(
    `<meta\\s+[^>]*(?:property|name)=["']${name}["'][^>]*content=["']([^"']*?)["']` +
    `|<meta\\s+[^>]*content=["']([^"']*?)["'][^>]*(?:property|name)=["']${name}["']`,
    'i',
  );
  const m = html.match(re);
  return m?.[1] || m?.[2] || null;
}

function titleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m?.[1]?.trim() || null;
}

export async function extractArticle(url: string): Promise<ArticleMeta> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
  });
  const html = await res.text();

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
