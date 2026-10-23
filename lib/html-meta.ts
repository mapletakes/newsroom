// Regex-based <meta>/<title> extraction, shared by every extractor that
// falls back to scraping a page's own HTML (extract-article.ts, and
// extract-tiktok.ts for the pages TikTok's embedded JSON doesn't cover —
// hashtag pages, music pages, anything that isn't a single video). Split out
// once a second extractor needed the identical parsing rather than a second
// hand-rolled copy of the same regex.

/** <meta property="name" content="..."> or <meta name="name" content="...">,
 *  property/name order and quote style both handled. The content value runs
 *  to its own closing quote, so the other quote character inside it survives
 *  (content="it's here" is "it's here", not "it"). Returned raw — entities
 *  like &amp; are left as-is; see decodeHtmlEntities. */
export function metaTag(html: string, name: string): string | null {
  const value = `content=(?:"([^"]*)"|'([^']*)')`;
  const re = new RegExp(
    `<meta\\s+[^>]*(?:property|name)=["']${name}["'][^>]*${value}` +
    `|<meta\\s+[^>]*${value}[^>]*(?:property|name)=["']${name}["']`,
    'i',
  );
  const m = html.match(re);
  return m?.[1] || m?.[2] || m?.[3] || m?.[4] || null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

/** Decodes the HTML entities a meta tag's content attribute can carry —
 *  named (&amp; &quot; …) and numeric (&#064; &#x2022;). Unknown named
 *  entities are left untouched rather than guessed at. */
export function decodeHtmlEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? whole;
  });
}

export function titleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m?.[1]?.trim() || null;
}
