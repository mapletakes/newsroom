// TikTok metadata extraction. Referenced an earlier draft PR for the general
// approach (TikTok embeds a rich JSON blob in the page, same idea as
// extract-youtube.ts's ytInitialPlayerResponse scrape) but rebuilt against
// this file's own conventions rather than adopting it as-is — the draft had
// a hand-rolled multi-hop redirect walker with no per-hop timeout (this app
// already accepts "an extractor fetches whatever a submitted URL redirects
// to," same as extract-article.ts below, so there was no need to reimplement
// redirect-following at all), threw on anything that wasn't a canonical
// /@user/video/id URL (silently breaking extraction for photo posts, sound
// pages, anything TikTok's UI reshapes later), and fabricated `new
// Date().toISOString()` as a published date whenever the real one couldn't
// be found rather than just leaving it null.
import { metaTag, titleTag } from './html-meta';
import { safeFetchText } from './safe-fetch';

export type TikTokMeta = {
  title: string | null;
  description: string | null;
  thumbnail: string | null;
  publisher: string | null;
  author: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
};

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const EMPTY: TikTokMeta = {
  title: null,
  description: null,
  thumbnail: null,
  publisher: null,
  author: null,
  publishedAt: null,
  durationSeconds: null,
};

/** The caption doubles as both title and description in TikTok's own OG
 *  tags, and it's usually hashtag-heavy ("check this out #fyp #politics
 *  #viral") — fine as body text, cluttered as a headline. Only the title
 *  gets this treatment; sanitizeStatusNote-style callers that want the raw
 *  caption (the description field) get it unstripped. */
export function stripHashtags(raw: string): string {
  return raw.replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * TikTok embeds the page's own render state as JSON in a
 * __UNIVERSAL_DATA_FOR_REHYDRATION__ script tag — the only place a real
 * video duration or exact upload timestamp is available (OG tags and oEmbed
 * both omit them). Present on a standard video page; absent on photo posts,
 * profile pages, hashtag pages, and anything else TikTok's front end has
 * reshaped since — so this returns null rather than throwing whenever the
 * shape doesn't match, letting the caller fall back to OG/oEmbed instead of
 * failing the whole extraction over a page TikTok didn't render as expected.
 */
export function extractVideoItem(html: string): Record<string, unknown> | null {
  const scriptMatch = html.match(
    /<script[^>]*id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!scriptMatch) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = JSON.parse(scriptMatch[1]) as any;
    const itemStruct = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
    return itemStruct && typeof itemStruct === 'object' ? itemStruct : null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function itemDurationSeconds(item: any): number | null {
  const dur = item?.video?.duration ?? item?.duration;
  return typeof dur === 'number' && dur > 0 ? Math.round(dur) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function itemPublishedAt(item: any): string | null {
  // createTime is Unix seconds; some responses also carry a pre-formatted
  // createTimeISO. Neither is guaranteed, and there's no honest fallback for
  // "unknown" other than leaving this null — the caption doesn't carry a
  // date, and stamping "now" would claim a fact nobody actually observed.
  const createTime = item?.createTime;
  if (typeof createTime === 'number' && createTime > 0) {
    const d = new Date(createTime * 1000);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return typeof item?.createTimeISO === 'string' ? item.createTimeISO : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function itemAuthor(item: any): string | null {
  const uniqueId = item?.author?.uniqueId;
  if (typeof uniqueId === 'string' && uniqueId) return `@${uniqueId}`;
  const nickname = item?.author?.nickname;
  return typeof nickname === 'string' && nickname ? nickname : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function itemThumbnail(item: any): string | null {
  return item?.video?.originCover || item?.video?.cover || null;
}

type OEmbed = { title?: string; author_name?: string; thumbnail_url?: string; provider_name?: string };

async function fetchOEmbed(url: string): Promise<OEmbed | null> {
  try {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    return (await r.json()) as OEmbed;
  } catch {
    return null;
  }
}

/**
 * Best-effort on every field, never throws — a submission that turns out to
 * be a hashtag page or a since-deleted video still gets whatever OG tags or
 * oEmbed can offer instead of failing the whole extraction (see the file
 * comment for why the source this was drafted from didn't do that).
 *
 * Following redirects (via safeFetchText, which validates each hop rather
 * than trusting fetch()'s own automatic chase) doubles as short-link
 * resolution: a vm.tiktok.com/vt.tiktok.com link's response body IS the
 * final video page's HTML, so there's no separate resolve step to get
 * wrong.
 */
export async function extractTikTok(url: string): Promise<TikTokMeta> {
  let html = '';
  let resolvedUrl = url;
  try {
    const res = await safeFetchText(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
      maxBytes: 3 * 1024 * 1024,
      timeoutMs: 10000,
    });
    resolvedUrl = res.url || url;
    html = res.text;
  } catch {
    return EMPTY;
  }

  const item = extractVideoItem(html);
  const oembed = html ? await fetchOEmbed(resolvedUrl) : null;

  const ogTitle = metaTag(html, 'og:title') || metaTag(html, 'twitter:title');
  const caption = typeof item?.desc === 'string' ? item.desc : null;
  const description = caption || ogTitle || null;

  const rawTitle = ogTitle || caption || oembed?.title || titleTag(html);
  const title = rawTitle ? stripHashtags(rawTitle) || rawTitle : null;

  return {
    title,
    description,
    thumbnail: itemThumbnail(item) || metaTag(html, 'og:image') || metaTag(html, 'twitter:image') || oembed?.thumbnail_url || null,
    publisher: metaTag(html, 'og:site_name') || oembed?.provider_name || 'TikTok',
    author: itemAuthor(item) || oembed?.author_name || null,
    publishedAt: itemPublishedAt(item),
    durationSeconds: itemDurationSeconds(item),
  };
}
