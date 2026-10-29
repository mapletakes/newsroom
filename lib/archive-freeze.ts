// Freezes a web page into one self-contained, script-free HTML file — the
// in-house replacement for archive.today. Same idea as archive.today and the
// SingleFile extension: take the page as fetched, throw away everything that
// executes, and pull every stylesheet, image and font inline so the snapshot
// still renders after the original changes or disappears.
//
// Two layers keep a hostile page from doing anything when served from our
// domain, and neither is trusted alone:
//  - here, scripts, frames, plugins, forms and event-handler/javascript:
//    attributes are stripped;
//  - app/a/[id]/route.ts serves the result with a `sandbox` CSP and
//    `default-src 'none'`, so anything that slips through can't run, can't
//    reach our cookies (the document gets an opaque origin) and can't load
//    from the network.
//
// Removing scripts also defeats most "soft" paywalls for free: the full text
// is in the HTML and a script hides it, and that script never runs. Hard
// paywalls (text only sent to subscribers) need the browser-extension capture
// planned as phase 2, which will hand its rendered DOM to freezeHtml().
//
// Size: the frozen page is served through a Vercel function, whose response
// body is capped at 4.5 MB, so inlined assets share a byte budget. Stylesheets
// go first (layout), then content images in document order, then CSS
// backgrounds and fonts. Whatever doesn't fit is dropped rather than left
// pointing at the original — the CSP would block it anyway, and a remote
// image would leak every viewer's IP to the publisher.

import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { safeFetchBytes, type SafeFetchBytesResult, type SafeFetchOptions } from './safe-fetch';

export type FetchBytes = (url: string, options?: SafeFetchOptions) => Promise<SafeFetchBytesResult>;

export type FreezeOptions = {
  fetchBytes?: FetchBytes;
  capturedAt?: Date;
  maxBytes?: number; // budget for the whole frozen document
  deadlineMs?: number; // stop starting new asset fetches after this
};

export type FreezeResult = {
  html: string;
  title: string | null;
  finalUrl: string;
  bytes: number;
  assetsInlined: number;
  assetsDropped: number;
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const MAX_ASSET_BYTES = 800 * 1024;
const MAX_CSS_BYTES = 1024 * 1024;
const CONCURRENCY = 8;
// Largest srcset candidate we'll pick. Big enough to look sharp in a normal
// article column; anything wider mostly just burns the byte budget.
const MAX_IMAGE_WIDTH = 1200;

const REMOVE_SELECTORS = [
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal',
  'base', 'template', 'input', 'button', 'select', 'textarea', 'link',
  'meta[http-equiv]', 'meta[charset]', 'meta[name="robots"]', 'audio', 'track',
].join(',');

const LAZY_SRC_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-lazy'];
const LAZY_SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset'];
const DANGEROUS_VALUE = /^\s*(javascript|vbscript|data\s*:\s*text\/html)/i;
const DROP_ATTRS = new Set(['srcdoc', 'formaction', 'action', 'ping', 'integrity', 'nonce', 'crossorigin', 'srcset', 'sizes']);

/** Fetches `url` and freezes it. Throws if the page can't be fetched or
 *  isn't HTML — the caller falls back to an archive.today link. */
export async function freezePage(url: string, options: FreezeOptions = {}): Promise<FreezeResult> {
  const fetchBytes = options.fetchBytes ?? safeFetchBytes;
  const res = await fetchBytes(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: 15000,
  });
  if (res.status >= 400) throw new Error(`page returned HTTP ${res.status}`);
  if (res.contentType && !/html|xml/i.test(res.contentType)) {
    throw new Error(`not an HTML page (${res.contentType})`);
  }
  const html = decode(res.bytes, res.contentType);
  return freezeHtml(html, res.url, options);
}

/** Freezes already-fetched HTML. `pageUrl` resolves relative links. */
export async function freezeHtml(html: string, pageUrl: string, options: FreezeOptions = {}): Promise<FreezeResult> {
  const fetchBytes = options.fetchBytes ?? safeFetchBytes;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const deadline = Date.now() + (options.deadlineMs ?? 35000);
  const capturedAt = options.capturedAt ?? new Date();

  // scriptingEnabled: false parses <noscript> contents as real elements, which
  // is what a browser without JS shows — and our snapshot is exactly that.
  const $ = cheerio.load(html, { scriptingEnabled: false });

  const baseHref = $('base[href]').first().attr('href');
  const baseUrl = resolveUrl(baseHref, pageUrl) ?? pageUrl;
  const resolve = (u: string | undefined) => resolveUrl(u, baseUrl);

  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    null;

  unwrapNoscript($);

  // Stylesheets are fetched before the rest of the DOM is stripped, since
  // <link> elements are in the removal list.
  const sheets = $('link[href]')
    .filter((_, el) => /(^|\s)stylesheet(\s|$)/i.test($(el).attr('rel') ?? ''))
    .toArray();
  const cssTexts = await Promise.all(
    sheets.map((el) => fetchCss(resolve($(el).attr('href')), fetchBytes, pageUrl, 0)),
  );
  sheets.forEach((el, i) => {
    const css = cssTexts[i];
    if (css == null) return;
    const media = $(el).attr('media');
    const style = $('<style></style>').text(css.text);
    style.attr('data-href', css.url);
    if (media && media !== 'all') style.attr('media', media);
    $(el).replaceWith(style);
  });

  $('video[poster]').each((_, el) => {
    $(el).replaceWith($('<img>').attr('src', $(el).attr('poster')!).attr('alt', ''));
  });
  $('video').remove();
  $(REMOVE_SELECTORS).remove();
  $('form').each((_, el) => {
    $(el).replaceWith($(el).contents());
  });

  // Every <img> ends up with a single absolute src, chosen from lazy-load
  // attributes and srcset, so the inliner below has one URL per image.
  $('img').each((_, el) => {
    const img = $(el);
    const src = pickImageSrc(img);
    const abs = resolve(src);
    for (const a of [...LAZY_SRC_ATTRS, ...LAZY_SRCSET_ATTRS, 'loading', 'decoding']) img.removeAttr(a);
    if (abs) img.attr('src', abs);
    else img.removeAttr('src');
  });
  $('picture source').remove();

  sanitizeAttributes($);

  $('a[href]').each((_, el) => {
    const a = $(el);
    const href = a.attr('href')!;
    if (href.startsWith('#')) return;
    const abs = resolve(href);
    if (abs) a.attr('href', abs).attr('rel', 'noopener noreferrer');
    else a.removeAttr('href');
  });
  // SVG <use> pointing at another document can't load under the CSP; keep
  // in-document references only.
  $('use').each((_, el) => {
    for (const attr of ['href', 'xlink:href']) {
      const v = $(el).attr(attr);
      if (v && !v.startsWith('#')) $(el).removeAttr(attr);
    }
  });

  // --- Inline assets, highest priority first, within the byte budget. ---
  const inliner = new Inliner(fetchBytes, pageUrl, deadline);
  let used = Buffer.byteLength($.html(), 'utf8');

  const contentImages = $('img[src], image[href], image[xlink\\:href]').toArray();
  const imageUrls = contentImages.map((el) => {
    const raw = $(el).attr('src') ?? $(el).attr('href') ?? $(el).attr('xlink:href');
    return raw?.startsWith('data:') ? null : resolve(raw);
  });
  await inliner.prefetch(imageUrls.filter((u): u is string => !!u));
  contentImages.forEach((el, i) => {
    const u = imageUrls[i];
    if (!u) return;
    const attr = el.name === 'img' ? 'src' : $(el).attr('href') ? 'href' : 'xlink:href';
    const data = inliner.take(u, maxBytes - used);
    if (data) {
      $(el).attr(attr, data);
      used += data.length;
    } else {
      $(el).removeAttr(attr);
    }
  });

  // CSS url()s: in <style> blocks (each with its own base URL) and style="".
  const styleBlocks = $('style').toArray();
  const styleAttrs = $('[style]').toArray();
  const cssUrls = new Set<string>();
  for (const el of styleBlocks) {
    const base = $(el).attr('data-href') ?? baseUrl;
    for (const u of cssUrlRefs($(el).text(), base)) cssUrls.add(u);
  }
  for (const el of styleAttrs) {
    for (const u of cssUrlRefs($(el).attr('style') ?? '', baseUrl)) cssUrls.add(u);
  }
  await inliner.prefetch([...cssUrls]);
  const rewriteCss = (css: string, base: string) =>
    rewriteCssUrls(css, base, (abs) => {
      const data = inliner.take(abs, maxBytes - used);
      if (data) used += data.length;
      return data;
    });
  for (const el of styleBlocks) {
    const base = $(el).attr('data-href') ?? baseUrl;
    $(el).text(rewriteCss($(el).text(), base)).removeAttr('data-href');
  }
  for (const el of styleAttrs) {
    $(el).attr('style', rewriteCss($(el).attr('style') ?? '', baseUrl));
  }

  // --- Head metadata and the archive banner. ---
  const head = $('head');
  head.prepend('<meta name="robots" content="noindex, nofollow">');
  head.prepend('<meta charset="utf-8">');
  if (!$('meta[name="viewport"]').length) {
    head.append('<meta name="viewport" content="width=device-width, initial-scale=1">');
  }
  $('body').prepend(banner(pageUrl, capturedAt));

  const out = '<!DOCTYPE html>\n' + $.html().replace(/^<!DOCTYPE[^>]*>\s*/i, '');
  return {
    html: out,
    title,
    finalUrl: pageUrl,
    bytes: Buffer.byteLength(out, 'utf8'),
    assetsInlined: inliner.inlined,
    assetsDropped: inliner.dropped,
  };
}

// ---------------------------------------------------------------------------

function decode(bytes: Buffer, contentType: string | null): string {
  const fromHeader = contentType && /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const head = bytes.subarray(0, 4096).toString('latin1');
  const fromMeta =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  for (const label of [fromHeader, fromMeta, 'utf-8']) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      /* unknown label — try the next one */
    }
  }
  return bytes.toString('utf8');
}

export function resolveUrl(u: string | undefined | null, base: string): string | null {
  if (!u) return null;
  const trimmed = u.trim();
  if (!trimmed || DANGEROUS_VALUE.test(trimmed)) return null;
  if (trimmed.startsWith('data:')) return trimmed;
  try {
    const abs = new URL(trimmed, base);
    return abs.protocol === 'http:' || abs.protocol === 'https:' ? abs.toString() : null;
  } catch {
    return null;
  }
}

/** Lazy-load libraries usually leave a no-JS copy of the image in a sibling
 *  <noscript>. Unwrapping it would show the picture twice once the lazy
 *  <img> is resolved too, so the lazy one is dropped in favour of the
 *  noscript copy, which is the publisher's own canonical markup. */
function unwrapNoscript($: cheerio.CheerioAPI) {
  $('noscript').each((_, el) => {
    const ns = $(el);
    if (ns.find('img').length) {
      const prev = ns.prev();
      if (prev.is('img')) prev.remove();
    }
    ns.replaceWith(ns.contents());
  });
}

function pickImageSrc(img: cheerio.Cheerio<Element>): string | undefined {
  const src = img.attr('src');
  const placeholder = !src || src.startsWith('data:') || /blank|placeholder|spacer|transparent/i.test(src);
  for (const a of LAZY_SRCSET_ATTRS) {
    const best = bestFromSrcset(img.attr(a));
    if (best && placeholder) return best;
  }
  for (const a of LAZY_SRC_ATTRS) {
    const v = img.attr(a);
    if (v && placeholder) return v;
  }
  const fromSrcset = bestFromSrcset(img.attr('srcset')) ?? bestFromSrcset(img.parent('picture').find('source[srcset]').first().attr('srcset'));
  return fromSrcset ?? src;
}

export function bestFromSrcset(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined;
  const candidates = srcset
    .split(/,\s+(?=\S)/)
    .map((part) => {
      const [u, d] = part.trim().split(/\s+/);
      const m = /^(\d+(?:\.\d+)?)([wx])$/.exec(d ?? '');
      // Treat density descriptors as a rough width so one ordering works.
      const width = m ? Number(m[1]) * (m[2] === 'x' ? 600 : 1) : 600;
      return { u, width };
    })
    .filter((c) => c.u);
  if (!candidates.length) return undefined;
  const fitting = candidates.filter((c) => c.width <= MAX_IMAGE_WIDTH).sort((a, b) => b.width - a.width);
  return (fitting[0] ?? candidates.sort((a, b) => a.width - b.width)[0]).u;
}

function sanitizeAttributes($: cheerio.CheerioAPI) {
  $('*').each((_, node) => {
    const el = node as Element;
    for (const name of Object.keys(el.attribs ?? {})) {
      const lower = name.toLowerCase();
      if (lower.startsWith('on') || DROP_ATTRS.has(lower) || DANGEROUS_VALUE.test(el.attribs[name])) {
        delete el.attribs[name];
      }
    }
  });
}

async function fetchCss(
  url: string | null,
  fetchBytes: FetchBytes,
  referer: string,
  depth: number,
): Promise<{ url: string; text: string } | null> {
  if (!url || url.startsWith('data:')) return null;
  try {
    const res = await fetchBytes(url, {
      headers: { 'User-Agent': UA, Accept: 'text/css,*/*;q=0.1', Referer: referer },
      maxBytes: MAX_CSS_BYTES,
      timeoutMs: 8000,
    });
    if (res.status >= 400) return null;
    let text = res.bytes.toString('utf8');
    // Inline @import one or two levels deep; deeper chains are rare and an
    // unbounded one would be a fetch loop.
    const imports = [...text.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?\s*([^;]*);/gi)];
    for (const m of imports) {
      const child = depth < 2 ? await fetchCss(resolveUrl(m[1], res.url), fetchBytes, referer, depth + 1) : null;
      const media = m[2].trim();
      const body = child ? (media ? `@media ${media} {\n${child.text}\n}` : child.text) : '';
      text = text.replace(m[0], body);
    }
    // Imported sheets' url()s are relative to *their* URL, not ours; make
    // them absolute now while we still know which sheet they came from.
    return { url: res.url, text: depth > 0 ? absolutizeCssUrls(text, res.url) : text };
  } catch {
    return null;
  }
}

const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;

function cssUrlRefs(css: string, base: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(CSS_URL)) {
    const abs = resolveUrl(m[2], base);
    if (abs && !abs.startsWith('data:')) out.push(abs);
  }
  return out;
}

function absolutizeCssUrls(css: string, base: string): string {
  return css.replace(CSS_URL, (whole, _q, u: string) => {
    if (u.startsWith('data:') || u.startsWith('#')) return whole;
    const abs = resolveUrl(u, base);
    return abs ? `url("${abs}")` : 'url("")';
  });
}

function rewriteCssUrls(css: string, base: string, inline: (abs: string) => string | null): string {
  return css.replace(CSS_URL, (whole, _q, u: string) => {
    if (u.startsWith('data:') || u.startsWith('#')) return whole;
    const abs = resolveUrl(u, base);
    const data = abs ? inline(abs) : null;
    return data ? `url("${data}")` : 'url("")';
  });
}

/** Fetches each asset once (pages reuse the same icon or font many times),
 *  then hands out data: URIs while the byte budget lasts. Every reference is
 *  budgeted, repeats included, since a data: URI is copied in full each time. */
class Inliner {
  private ready = new Map<string, string | null>();
  inlined = 0;
  dropped = 0;

  constructor(private fetchBytes: FetchBytes, private referer: string, private deadline: number) {}

  async prefetch(urls: string[]) {
    const todo = [...new Set(urls)].filter((u) => !this.ready.has(u));
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const u = todo[next++];
        this.ready.set(u, Date.now() > this.deadline ? null : await this.load(u));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  }

  take(url: string, remaining: number): string | null {
    const data = this.ready.get(url) ?? null;
    if (data && data.length <= remaining) {
      this.inlined++;
      return data;
    }
    this.dropped++;
    return null;
  }

  private async load(url: string): Promise<string | null> {
    try {
      const res = await this.fetchBytes(url, {
        headers: { 'User-Agent': UA, Accept: 'image/*,font/*,*/*;q=0.5', Referer: this.referer },
        maxBytes: MAX_ASSET_BYTES,
        timeoutMs: 8000,
      });
      if (res.status >= 400 || res.truncated || !res.bytes.length) return null;
      const mime = assetMime(res.contentType, url);
      if (!mime) return null;
      return `data:${mime};base64,${res.bytes.toString('base64')}`;
    } catch {
      return null;
    }
  }
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
};

/** Only images and fonts are ever inlined: a stray HTML or script response
 *  behind an image URL is refused rather than smuggled into a data: URI. */
function assetMime(contentType: string | null, url: string): string | null {
  const ct = contentType?.split(';')[0].trim().toLowerCase();
  if (ct && (ct.startsWith('image/') || ct.startsWith('font/'))) return ct;
  if (ct && /^application\/(font-woff2?|x-font-\w+|vnd\.ms-fontobject)$/.test(ct)) return ct;
  const ext = /\.([a-z0-9]+)(?:$|[?#])/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  if ((!ct || ct === 'application/octet-stream' || ct === 'binary/octet-stream') && ext && EXT_MIME[ext]) {
    return EXT_MIME[ext];
  }
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Static header across the top of the snapshot, like archive.today's. Inline
 *  styles with `all: initial` so the page's own CSS can't restyle it. */
function banner(url: string, capturedAt: Date): string {
  const when = capturedAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  })();
  const box =
    'all:initial;display:block;box-sizing:border-box;width:100%;position:relative;z-index:2147483647;' +
    'background:#1c1917;color:#f5f5f4;font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;' +
    'padding:8px 16px;border-bottom:2px solid #a16207;';
  const link = 'all:initial;color:#fbbf24;font:inherit;text-decoration:underline;cursor:pointer;word-break:break-all;';
  return (
    `<div data-broadside-archive style="${box}">` +
    `<span style="all:initial;font:inherit;color:inherit;font-weight:700;">The Broadside archive</span>` +
    `<span style="all:initial;font:inherit;color:inherit;"> · Snapshot of </span>` +
    `<a href="${escapeHtml(url)}" rel="noopener noreferrer" style="${link}">${escapeHtml(host)}</a>` +
    `<span style="all:initial;font:inherit;color:#a8a29e;"> taken ${when}. Scripts, forms and some images are removed.</span>` +
    `</div>`
  );
}

