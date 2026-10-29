// Recovers article text a page shipped but only renders with JavaScript.
//
// A frozen snapshot never runs scripts, so anything a page builds client-side
// is missing from it. On many news sites that's most of the article: the
// server renders a paragraph or two and the rest arrives as JSON in the same
// response — JSON-LD `articleBody` for search engines, or the framework's
// page data (Next.js `__NEXT_DATA__`, Arc XP `content_elements`, ProseMirror
// style `body.content` trees as on Bloomberg). Every visitor receives that
// data; the page's own scripts decide what to draw. This reads it back and
// appends whatever the visible page is missing.
//
// It cannot recover what the server never sent — a hard paywall that strips
// the text for logged-out readers (e.g. the Washington Post) stays truncated.

import type * as cheerio from 'cheerio';

export type Recovered = { paragraphs: string[]; source: 'json-ld' | 'page-data' };

// schema.org's Article family: NewsArticle, ReportageNewsArticle,
// OpinionNewsArticle, BlogPosting, LiveBlogPosting, …
const ARTICLE_TYPES = /(Article|Posting)$/;
const PARA_TYPES = /^(paragraph|text|p|blockquote|quote|heading|h[1-6]|list[-_]?item|li|subheadline|pullquote)$/i;
const TEXT_KEYS = new Set(['value', 'text', 'content', 'html', 'body', 'children', 'items']);
const MIN_PARA = 40;

function stripTags(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function walk(o: unknown, f: (x: unknown) => void) {
  f(o);
  if (Array.isArray(o)) o.forEach((x) => walk(x, f));
  else if (o && typeof o === 'object') Object.values(o).forEach((x) => walk(x, f));
}

/** All text under an inline-content node (Bloomberg's text/entity runs,
 *  Arc's `content` HTML), ignoring link targets, ids and the like. */
function inlineText(o: unknown): string {
  if (typeof o === 'string') return o;
  if (Array.isArray(o)) return o.map(inlineText).join('');
  if (o && typeof o === 'object') {
    return Object.entries(o)
      .filter(([k]) => TEXT_KEYS.has(k))
      .map(([, v]) => inlineText(v))
      .join('');
  }
  return '';
}

/** One block of a body array as paragraph text, or '' if it isn't prose
 *  (images, embeds, author cards, ads). */
function blockText(el: unknown): string {
  if (typeof el === 'string') return stripTags(el);
  if (el && typeof el === 'object' && !Array.isArray(el)) {
    const type = (el as Record<string, unknown>).type;
    if (typeof type === 'string' && !PARA_TYPES.test(type)) return '';
    if (typeof type !== 'string' && !('content' in el || 'value' in el || 'text' in el)) return '';
    return stripTags(inlineText(el));
  }
  return '';
}

/** The array in a page-data blob that reads most like an article body. */
function bestBodyArray(data: unknown): string[] {
  let best: string[] = [];
  let bestLen = 0;
  walk(data, (x) => {
    if (!Array.isArray(x) || x.length < 3) return;
    const paras = x.map(blockText).filter((t) => t.length >= MIN_PARA);
    if (paras.length < 3) return;
    const len = paras.reduce((a, p) => a + p.length, 0);
    if (len > bestLen) {
      best = paras;
      bestLen = len;
    }
  });
  return best;
}

/** articleBody as paragraphs: by its line breaks (or </p>s) when it has
 *  them, else every few sentences. */
function splitBody(raw: string): string[] {
  const body = raw.replace(/<\/p>/gi, '\n');
  const parts = body.split(/\n+/).map(stripTags).filter(Boolean);
  if (parts.length > 1) return parts;
  // One long run with no line breaks: break it every few sentences.
  const flat = stripTags(body);
  const sentences = flat.match(/[^.!?]+[.!?]+["”’)]*\s*/g) ?? [flat];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    cur += s;
    if (cur.length > 500) {
      out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Whether the page says it's an article (so arrays on home and section
 *  pages, full of teasers, are never mistaken for a body). */
export function isArticlePage($: cheerio.CheerioAPI): boolean {
  if (/article/i.test($('meta[property="og:type"]').attr('content') ?? '')) return true;
  let found = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      walk(JSON.parse($(el).text()), (x) => {
        const t = (x as Record<string, unknown> | null)?.['@type'];
        if ((typeof t === 'string' && ARTICLE_TYPES.test(t)) || (Array.isArray(t) && t.some((v) => ARTICLE_TYPES.test(String(v))))) {
          found = true;
        }
      });
    } catch {
      /* malformed JSON-LD is common; ignore it */
    }
  });
  return found;
}

/** Reads embedded article text. Must run before scripts are stripped. */
export function findEmbeddedArticle($: cheerio.CheerioAPI): Recovered | null {
  let ld: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      walk(JSON.parse($(el).text()), (x) => {
        const body = (x as Record<string, unknown> | null)?.articleBody;
        if (typeof body === 'string' && body.length > ld.join(' ').length) ld = splitBody(body);
      });
    } catch {
      /* ignore */
    }
  });

  let data: string[] = [];
  $('script#__NEXT_DATA__, script#__NUXT_DATA__, script[type="application/json"]').each((_, el) => {
    const text = $(el).text();
    if (text.length < 2000) return;
    try {
      const body = bestBodyArray(JSON.parse(text));
      if (body.join(' ').length > data.join(' ').length) data = body;
    } catch {
      /* not JSON */
    }
  });

  const ldLen = ld.join(' ').length;
  const dataLen = data.join(' ').length;
  if (!ldLen && !dataLen) return null;
  return dataLen > ldLen ? { paragraphs: data, source: 'page-data' } : { paragraphs: ld, source: 'json-ld' };
}

/** Whether the page's own structured data says some of it is for
 *  subscribers only (schema.org isAccessibleForFree: false, which Google
 *  requires of paywalled news). */
export function isMarkedPaywalled($: cheerio.CheerioAPI): boolean {
  let walled = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      walk(JSON.parse($(el).text()), (x) => {
        const v = (x as Record<string, unknown> | null)?.isAccessibleForFree;
        if (v === false || v === 'False' || v === 'false') walled = true;
      });
    } catch {
      /* ignore */
    }
  });
  return walled;
}

/** Selectors Google's paywall markup says hold the subscriber-only part. */
export function paywalledSelectors($: cheerio.CheerioAPI): string[] {
  const out = new Set<string>();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      walk(JSON.parse($(el).text()), (x) => {
        const o = x as Record<string, unknown> | null;
        if (o?.isAccessibleForFree === false || o?.isAccessibleForFree === 'False' || o?.isAccessibleForFree === 'false') {
          const sel = o.cssSelector;
          if (typeof sel === 'string' && /^[\w.#\-\s,[\]="':>]+$/.test(sel)) out.add(sel);
        }
      });
    } catch {
      /* ignore */
    }
  });
  return [...out];
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function articleScope($: cheerio.CheerioAPI) {
  const article = $('article').toArray().sort((a, b) => $(b).text().length - $(a).text().length)[0];
  if (article) return $(article);
  const main = $('main').first();
  return main.length ? main : $('body');
}

/** Appends the recovered paragraphs the page doesn't already show, after its
 *  last visible paragraph. Returns how many were added. */
export function injectRecovered($: cheerio.CheerioAPI, rec: Recovered): number {
  const scope = articleScope($);
  const visible = scope
    .find('p')
    .toArray()
    .map((p) => norm($(p).text()))
    .filter((t) => t.length >= MIN_PARA);
  const visibleText = visible.join(' ');
  const missing = rec.paragraphs.filter((p) => !visibleText.includes(norm(p).slice(0, 80)));
  const missingLen = missing.reduce((a, p) => a + p.length, 0);
  // Only when the page is clearly short of its own text — a page that shows
  // the full article must come out untouched.
  if (missing.length < 2 || missingLen < Math.max(400, visibleText.length * 0.5)) return 0;

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const label =
    'all:initial;display:block;margin:1.5em 0 1em;padding:6px 10px;border-left:3px solid #a16207;' +
    'font:12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;color:#57534e;background:#fafaf9;';
  const html =
    `<section data-broadside-recovered>` +
    `<div style="${label}">The Broadside archive: the rest of this article was recovered from ` +
    `${rec.source === 'json-ld' ? 'structured data' : 'data'} embedded in the page, which its scripts would normally display.</div>` +
    missing.map((p) => `<p>${esc(p)}</p>`).join('') +
    `</section>`;

  const lastP = scope.find('p').filter((_, p) => $(p).text().trim().length >= MIN_PARA).last();
  if (lastP.length) lastP.after(html);
  else scope.append(html);
  return missing.length;
}
