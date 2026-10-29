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
// is in the HTML and a script hides it, and that script never runs. Text a
// page ships as data but only draws with scripts (JSON-LD, Next.js page data)
// is put back by lib/archive-recover.ts. Hard paywalls (text only sent to
// subscribers) need the browser-extension capture planned as phase 2, which
// will hand its rendered DOM to freezeHtml().
//
// Size: the frozen page is served through a Vercel function, whose response
// body is capped at 4.5 MB, so inlined assets share a byte budget. CSS the
// page can't use is dropped first (lib/archive-css.ts — on news sites that's
// most of it, fonts especially). Then content images go in document order,
// then CSS images, then fonts. Whatever doesn't fit is dropped rather than
// left pointing at the original — the CSP would block it anyway, and a
// remote image would leak every viewer's IP to the publisher.

import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { safeFetchBytes, type SafeFetchBytesResult, type SafeFetchOptions } from './safe-fetch';
import { documentTokens, fontFaceUrls, pruneStylesheets } from './archive-css';
import { findEmbeddedArticle, injectRecovered, isArticlePage, isMarkedPaywalled, paywalledSelectors } from './archive-recover';

export type FetchBytes = (url: string, options?: SafeFetchOptions) => Promise<SafeFetchBytesResult>;

export type FreezeOptions = {
  fetchBytes?: FetchBytes;
  capturedAt?: Date;
  maxBytes?: number; // budget for the whole frozen document
  deadlineMs?: number; // stop starting new asset fetches after this
  // Set when the page came from another archive's copy rather than the site
  // itself; named in the banner.
  via?: { name: string; url: string; capturedAt: Date };
  // Fetch the page's assets through this prefix (an archive's raw-copy URL)
  // rather than from their own hosts.
  assetPrefix?: string;
  // Fall back to the Wayback Machine's copy of a free article when the site
  // refuses us. Default true.
  wayback?: boolean;
};

export type FreezeResult = {
  html: string;
  title: string | null;
  finalUrl: string;
  bytes: number;
  assetsInlined: number;
  assetsDropped: number;
  recoveredParagraphs: number; // article text restored from embedded data
  via: string | null; // set when the page came from another archive's copy
};

/** The site refused our request outright (a bot wall, not a missing page)
 *  and no usable free copy exists elsewhere. Capturing it from the reader's
 *  own browser, with the extension, is the way in. */
export class SiteRefusedError extends Error {
  constructor(
    public status: number,
    // Whether a free copy could still turn up (asking the Wayback Machine to
    // save the page is worthwhile): false for subscription publishers and
    // for copies that turned out to be paywalled.
    public freeCopyPossible: boolean,
  ) {
    super(`site refused the request (HTTP ${status})`);
    this.name = 'SiteRefusedError';
  }
}

// Statuses that mean "not for you" rather than "not here": bot walls (401,
// 403, 429), legal blocks (451) and the 503s some bot shields answer with.
const REFUSED = new Set([401, 403, 429, 451, 503]);

// Publishers whose articles are subscriber-only by default. A Wayback copy
// from these is never used even if its markup doesn't say so, since the
// fallback is for free articles only.
const SUBSCRIPTION_HOSTS =
  /(^|\.)(nytimes|wsj|ft|economist|bloomberg|washingtonpost|theatlantic|newyorker|wired|barrons|theglobeandmail|thetimes|telegraph|bostonglobe|businessinsider|thestar|nationalpost|latimes|newsweek|foreignpolicy|foreignaffairs|seattletimes|chicagotribune|sfchronicle|haaretz|lemonde|spiegel|faz)\.(com|co\.uk|ca|net|de|fr)$/i;

// A browser user agent, deliberately. An A/B run against 28 news sites found a
// self-identifying archiver UA no better anywhere and worse on four: Medium
// answered it 403, and Washington Post, CBC and NPR dropped the connection.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Longest we'll wait out a rate limit (429/503 with Retry-After) before the
// page fetch is treated as refused.
const MAX_RETRY_WAIT_MS = 4000;

/** Fetches the page, waiting out one short rate limit. A site that says
 *  "try again in a few seconds" isn't refusing us. */
async function fetchPage(fetchBytes: FetchBytes, url: string): Promise<SafeFetchBytesResult> {
  const opts = {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: 15000,
  };
  const res = await fetchBytes(url, opts);
  if (res.status !== 429 && res.status !== 503) return res;
  const wait = retryAfterMs(res.retryAfter);
  if (wait === null || wait > MAX_RETRY_WAIT_MS) return res;
  await new Promise((r) => setTimeout(r, wait));
  return fetchBytes(url, opts);
}

function retryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs) * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

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

/** Fetches `url` and freezes it. When the site refuses us, a free article
 *  is frozen from the Wayback Machine's copy instead; otherwise this throws
 *  SiteRefusedError. Throws plain errors for missing or non-HTML pages. */
export async function freezePage(url: string, options: FreezeOptions = {}): Promise<FreezeResult> {
  const fetchBytes = options.fetchBytes ?? safeFetchBytes;
  const res = await fetchPage(fetchBytes, url);
  if (REFUSED.has(res.status)) {
    const copy = options.wayback === false ? { kind: 'none' as const } : await waybackFreeCopy(url, fetchBytes);
    if (copy.kind !== 'free') throw new SiteRefusedError(res.status, copy.kind === 'none');
    // Assets come from the same capture: the site that refused the page
    // usually refuses its CSS too, and old asset paths go stale.
    return freezeHtml(copy.html, url, {
      ...options,
      via: { name: 'the Wayback Machine', url: copy.viewUrl, capturedAt: copy.capturedAt },
      assetPrefix: `https://web.archive.org/web/${copy.ts}id_/`,
    });
  }
  if (res.status >= 400) throw new Error(`page returned HTTP ${res.status}`);
  if (res.contentType && !/html|xml/i.test(res.contentType)) {
    throw new Error(`not an HTML page (${res.contentType})`);
  }
  const html = decode(res.bytes, res.contentType);
  return freezeHtml(html, res.url, options);
}

/** The Wayback Machine's most recent capture of `url`, if it's a free
 *  article: fetched raw (the `id_` form, without the Wayback toolbar or
 *  rewritten links) so it freezes like a live fetch. Null when there's no
 *  capture, or the copy is subscriber-only — by its own paywall markup or
 *  its publisher — since this fallback is for free articles only.
 *
 *  Looks the URL up in the CDX index (fresher than the availability API),
 *  as given and then without its query string, since shared links often
 *  carry tracking parameters the capture didn't. */
async function waybackFreeCopy(
  url: string,
  fetchBytes: FetchBytes,
): Promise<{ kind: 'free'; html: string; ts: string; viewUrl: string; capturedAt: Date } | { kind: 'none' | 'walled' }> {
  let host: string;
  const variants = [url];
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, '');
    if (u.search) {
      u.search = '';
      variants.push(u.toString());
    }
  } catch {
    return { kind: 'none' };
  }
  if (SUBSCRIPTION_HOSTS.test(host)) return { kind: 'walled' };

  for (const target of variants) {
    try {
      const cdx = await fetchBytes(
        `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target)}` +
          '&output=json&limit=-1&filter=statuscode:200&fl=timestamp,original',
        { headers: { 'User-Agent': UA, Accept: 'application/json' }, maxBytes: 64 * 1024, timeoutMs: 10000 },
      );
      if (cdx.status >= 400) continue;
      const rows = JSON.parse(cdx.bytes.toString('utf8') || '[]') as string[][];
      const [ts, original] = rows[rows.length - 1] ?? [];
      if (!ts || !/^\d{14}$/.test(ts)) continue;
      const res = await fetchBytes(`https://web.archive.org/web/${ts}id_/${original}`, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
        maxBytes: 5 * 1024 * 1024,
        timeoutMs: 20000,
      });
      if (res.status >= 400 || (res.contentType && !/html|xml/i.test(res.contentType))) continue;
      const html = decode(res.bytes, res.contentType);
      if (isMarkedPaywalled(cheerio.load(html))) return { kind: 'walled' };
      const capturedAt = new Date(
        `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`,
      );
      return { kind: 'free', html, ts, viewUrl: `https://web.archive.org/web/${ts}/${original}`, capturedAt };
    } catch {
      /* try the next variant */
    }
  }
  return { kind: 'none' };
}

/** Routes asset fetches through an archive's raw-copy prefix, reporting
 *  the original URL back so relative url()s in fetched CSS still resolve
 *  against the original site. */
function viaPrefix(fetchBytes: FetchBytes, prefix: string | undefined): FetchBytes {
  if (!prefix) return fetchBytes;
  return async (url, options) => {
    const res = await fetchBytes(prefix + url, options);
    return { ...res, url: res.url.replace(/^https:\/\/web\.archive\.org\/web\/\d+id_\//, '') };
  };
}

/** Freezes already-fetched HTML. `pageUrl` resolves relative links. */
export async function freezeHtml(html: string, pageUrl: string, options: FreezeOptions = {}): Promise<FreezeResult> {
  const fetchBytes = viaPrefix(options.fetchBytes ?? safeFetchBytes, options.assetPrefix);
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

  // Read embedded article text and paywall markup now: both live in
  // <script> tags, which are about to go.
  const recovered = isArticlePage($) ? findEmbeddedArticle($) : null;
  const paywalled = paywalledSelectors($);

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
    // The async-CSS trick — media="print" that an onload handler flips to
    // "all" — never flips without scripts, so apply the sheet as it would be.
    const onload = $(el).attr('onload') ?? '';
    const media = /media\s*=/.test(onload) ? undefined : $(el).attr('media');
    const style = $('<style></style>').text(css.text);
    style.attr('data-href', css.url);
    if (media && media !== 'all') style.attr('media', media);
    $(el).replaceWith(style);
  });

  $('video[poster]').each((_, el) => {
    $(el).replaceWith($('<img>').attr('src', $(el).attr('poster')!).attr('alt', ''));
  });
  $('video').remove();
  replaceEmbeds($, resolve);
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
    for (const a of [...LAZY_SRC_ATTRS, ...LAZY_SRCSET_ATTRS, 'loading', 'decoding', 'data-broadside-src']) img.removeAttr(a);
    if (abs) img.attr('src', abs);
    else img.removeAttr('src');
  });
  $('picture source').remove();
  // Tracking pixels: nothing to see, and fetching them reports a visit.
  $('img').each((_, el) => {
    const { width, height, src } = el.attribs;
    if ((Number(width) <= 1 && Number(height) <= 1 && width != null && height != null) || /\/akam\/\d+\/pixel_|scorecardresearch\.com|doubleclick\.net|google-analytics\.com|facebook\.com\/tr\b|bat\.bing\.com/.test(src ?? '')) {
      $(el).remove();
    }
  });

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

  const recoveredParagraphs = recovered ? injectRecovered($, recovered) : 0;
  // Content Google's paywall markup flags as subscriber-only is sometimes
  // already in the page and only hidden by CSS (a height clamp, a fade, a
  // blur); undo those on exactly the flagged elements.
  if (paywalled.length) {
    $('head').append(
      `<style>${paywalled.join(',')}{max-height:none!important;overflow:visible!important;` +
        'visibility:visible!important;opacity:1!important;filter:none!important;' +
        '-webkit-mask-image:none!important;mask-image:none!important}</style>',
    );
  }

  // Drop the CSS this page can't use before measuring anything against the
  // byte budget (see lib/archive-css.ts).
  const tokens = documentTokens($);
  const inlineStyles = $('[style]').toArray().map((el) => $(el).attr('style') ?? '');
  const styleEls = $('style').toArray();
  const pruned = pruneStylesheets(styleEls.map((el) => $(el).text()), tokens, inlineStyles);
  styleEls.forEach((el, i) => {
    $(el).text(pruned[i]);
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
  // Each reference costs a full copy of the data, so references are counted.
  const styleBlocks = $('style').toArray();
  const styleAttrs = $('[style]').toArray();
  const refs = new Map<string, number>();
  const fonts = new Set<string>();
  const countRefs = (css: string, base: string) => {
    for (const u of cssUrlRefs(css, base)) refs.set(u, (refs.get(u) ?? 0) + 1);
  };
  for (const el of styleBlocks) {
    const base = $(el).attr('data-href') ?? baseUrl;
    const css = $(el).text();
    countRefs(css, base);
    for (const f of fontFaceUrls(css)) {
      const abs = resolveUrl(f, base);
      if (abs) fonts.add(abs);
    }
  }
  for (const el of styleAttrs) countRefs($(el).attr('style') ?? '', baseUrl);
  await inliner.prefetch([...refs.keys()]);
  // CSS images (logos, icons, backgrounds) before fonts: without its web
  // fonts a page still reads fine in fallback type, but it loses meaning
  // without its pictures.
  const plan = new Map<string, string | null>();
  for (const fontPass of [false, true]) {
    for (const [u, n] of refs) {
      if (fonts.has(u) !== fontPass) continue;
      const data = inliner.take(u, maxBytes - used, n);
      if (data) used += data.length * n;
      plan.set(u, data);
    }
  }
  const rewriteCss = (css: string, base: string) => rewriteCssUrls(css, base, (abs) => plan.get(abs) ?? null);
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
  $('body').prepend(banner(pageUrl, capturedAt, options.via));

  const out = '<!DOCTYPE html>\n' + $.html().replace(/^<!DOCTYPE[^>]*>\s*/i, '');
  return {
    html: out,
    title,
    finalUrl: pageUrl,
    bytes: Buffer.byteLength(out, 'utf8'),
    assetsInlined: inliner.inlined,
    assetsDropped: inliner.dropped,
    recoveredParagraphs,
    via: options.via?.name ?? null,
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
  // A browser capture (extension/capture.js) records the image the reader
  // actually saw; nothing beats that.
  const seen = img.attr('data-broadside-src');
  if (seen) return seen;
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
  const own = bestFromSrcset(img.attr('srcset'));
  if (own) return own;
  if (!placeholder) return src;
  // A <picture> with no usable <img> source: take the <source> with no media
  // query (the default), else one for wide screens, rather than whichever is
  // first — that's usually the small mobile crop.
  const sources = img
    .parent('picture')
    .find('source')
    .toArray()
    .map((el) => ({ media: el.attribs.media ?? '', srcset: el.attribs.srcset ?? el.attribs['data-srcset'] }))
    .filter((x) => x.srcset);
  const pick =
    sources.find((x) => !x.media) ?? sources.find((x) => /min-width/i.test(x.media)) ?? sources[sources.length - 1];
  return bestFromSrcset(pick?.srcset) ?? src;
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
    // url(#id) points at an SVG element in the page, not a file.
    if (/^\s*(#|%23)/.test(m[2])) continue;
    const abs = resolveUrl(m[2], base);
    if (abs && !abs.startsWith('data:')) out.push(abs);
  }
  return out;
}

function absolutizeCssUrls(css: string, base: string): string {
  return css.replace(CSS_URL, (whole, _q, u: string) => {
    if (u.startsWith('data:') || /^\s*(#|%23)/.test(u)) return whole;
    const abs = resolveUrl(u, base);
    return abs ? `url("${abs}")` : 'url("")';
  });
}

function rewriteCssUrls(css: string, base: string, inline: (abs: string) => string | null): string {
  return css.replace(CSS_URL, (whole, _q, u: string) => {
    if (u.startsWith('data:') || /^\s*(#|%23)/.test(u)) return whole;
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

  take(url: string, remaining: number, refs = 1): string | null {
    const data = this.ready.get(url) ?? null;
    if (data && data.length * refs <= remaining) {
      this.inlined++;
      return data;
    }
    this.dropped++;
    return null;
  }

  // One retry for failures that are usually momentary (a dropped connection,
  // a timeout, a CDN's 429/5xx) — otherwise one blip loses that image or
  // font from the snapshot for good.
  private async load(url: string, attempt = 1): Promise<string | null> {
    try {
      const res = await this.fetchBytes(url, {
        headers: { 'User-Agent': UA, Accept: 'image/*,font/*,*/*;q=0.5', Referer: this.referer },
        maxBytes: MAX_ASSET_BYTES,
        timeoutMs: 8000,
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 2 && Date.now() < this.deadline) {
        return this.load(url, attempt + 1);
      }
      if (res.status >= 400 || res.truncated || !res.bytes.length) return null;
      const mime = assetMime(res.contentType, url, res.bytes);
      if (!mime) return null;
      return `data:${mime};base64,${res.bytes.toString('base64')}`;
    } catch {
      return attempt < 2 && Date.now() < this.deadline ? this.load(url, attempt + 1) : null;
    }
  }
}

/** An image or font type from the file's own signature, for servers that
 *  label assets wrongly (one major news CDN sends its fonts as
 *  application/x-www-form-urlencoded). */
export function sniffMime(bytes: Buffer): string | null {
  const ascii = (start: number, end: number) => bytes.subarray(start, end).toString('latin1');
  if (ascii(0, 4) === 'wOF2') return 'font/woff2';
  if (ascii(0, 4) === 'wOFF') return 'font/woff';
  if (ascii(0, 4) === 'OTTO') return 'font/otf';
  if (bytes.readUInt32BE(0) === 0x00010000 && bytes.length > 12) return 'font/ttf';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(8, 12))) return 'image/avif';
  return null;
}

/** Only images and fonts are ever inlined: a stray HTML or script response
 *  behind an image URL is refused rather than smuggled into a data: URI.
 *  A declared image/font type is trusted; otherwise the bytes must say so
 *  (or, for SVG, which has no fixed signature, a generic type plus the
 *  file extension). */
function assetMime(contentType: string | null, url: string, bytes: Buffer): string | null {
  const ct = contentType?.split(';')[0].trim().toLowerCase();
  if (ct && (ct.startsWith('image/') || ct.startsWith('font/'))) return ct;
  if (ct && /^application\/(font-woff2?|x-font-\w+|vnd\.ms-fontobject)$/.test(ct)) return ct;
  const sniffed = bytes.length >= 12 ? sniffMime(bytes) : null;
  if (sniffed) return sniffed;
  const ext = /\.([a-z0-9]+)(?:$|[?#])/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  if ((!ct || ct === 'application/octet-stream' || ct === 'binary/octet-stream') && ext === 'svg') return 'image/svg+xml';
  return null;
}

// Embeds worth keeping a pointer to when their iframe is stripped: video,
// social posts, maps and charts. Anything else in an iframe is usually an ad.
const EMBED_HOSTS =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|twitter\.com|x\.com|instagram\.com|tiktok\.com|facebook\.com|spotify\.com|soundcloud\.com|podcasts\.apple\.com|datawrapper\.dwcdn\.net|flo\.uri\.sh|public\.flourish\.studio|google\.com|documentcloud\.org|scribd\.com|reddit\.com|bsky\.app|threads\.net|twitch\.tv)$/i;

/** Swaps embedded iframes (videos, posts, charts) for a plain link to what
 *  was there, since the snapshot can't run them. */
function replaceEmbeds($: cheerio.CheerioAPI, resolve: (u: string | undefined) => string | null) {
  $('iframe').each((_, el) => {
    const src = resolve($(el).attr('src') ?? $(el).attr('data-src'));
    if (!src || src.startsWith('data:')) return;
    let host: string;
    try {
      host = new URL(src).hostname.replace(/^www\./, '');
    } catch {
      return;
    }
    if (!EMBED_HOSTS.test(host)) return;
    const title = $(el).attr('title')?.trim();
    const box =
      'display:block;margin:1em 0;padding:10px 12px;border:1px dashed #a8a29e;' +
      'font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;color:#57534e;';
    $(el).replaceWith(
      `<div data-broadside-embed style="${box}">Embedded content from ${escapeHtml(host)}` +
        (title ? ` (${escapeHtml(title)})` : '') +
        ` — <a href="${escapeHtml(src)}" rel="noopener noreferrer">open the original</a></div>`,
    );
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Static header across the top of the snapshot, like archive.today's. Inline
 *  styles with `all: initial` so the page's own CSS can't restyle it. */
const utc = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

function banner(url: string, capturedAt: Date, via?: FreezeOptions['via']): string {
  const when = utc(capturedAt);
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
    (via
      ? `<span style="all:initial;font:inherit;color:inherit;">, from </span>` +
        `<a href="${escapeHtml(via.url)}" rel="noopener noreferrer" style="${link}">${escapeHtml(via.name)}'s copy</a>` +
        `<span style="all:initial;font:inherit;color:#a8a29e;"> of ${utc(via.capturedAt)} (the site refuses archivers), saved ${when}.` +
        ` Scripts, forms and some images are removed.</span>`
      : `<span style="all:initial;font:inherit;color:#a8a29e;"> taken ${when}. Scripts, forms and some images are removed.</span>`) +
    `</div>`
  );
}

