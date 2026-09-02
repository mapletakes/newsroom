// Regex-based <meta>/<title> extraction, shared by every extractor that
// falls back to scraping a page's own HTML (extract-article.ts, and
// extract-tiktok.ts for the pages TikTok's embedded JSON doesn't cover —
// hashtag pages, music pages, anything that isn't a single video). Split out
// once a second extractor needed the identical parsing rather than a second
// hand-rolled copy of the same regex.

/** <meta property="name" content="..."> or <meta name="name" content="...">,
 *  property/name order and quote style both handled. */
export function metaTag(html: string, name: string): string | null {
  const re = new RegExp(
    `<meta\\s+[^>]*(?:property|name)=["']${name}["'][^>]*content=["']([^"']*?)["']` +
    `|<meta\\s+[^>]*content=["']([^"']*?)["'][^>]*(?:property|name)=["']${name}["']`,
    'i',
  );
  const m = html.match(re);
  return m?.[1] || m?.[2] || null;
}

export function titleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m?.[1]?.trim() || null;
}
