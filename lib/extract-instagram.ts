// Instagram metadata extraction. Instagram links used to fall through to the
// generic article extractor, which fetches with a desktop-Chrome user agent —
// and Instagram answers that (from a server, logged out) with a bare
// login-wall shell: <title>Instagram</title> and no OG tags at all, so every
// post landed on the deck titled just "Instagram".
//
// Link-preview crawlers get a different page: Instagram serves them real OG
// tags so a shared post unfurls properly in chat apps, and that's exactly the
// job this extractor is doing. So it identifies as one (Facebook's own
// preview crawler, which Instagram reliably serves) and reads those tags.
// There is no public no-auth oEmbed any more (Meta's requires an app token),
// and the /embed/captioned/ page carries nothing the OG tags don't.
//
// What the OG tags look like (en-US, as of Oct 2026):
//   og:title       The H3 Podcast on Instagram: "a message from the crew..."
//   og:description 100K likes, 5,331 comments - h3_podcast on October 22, 2026: "a message from the crew...".
// A post with no caption drops the `: "…"` tail from both. Everything below
// is best-effort against that shape and degrades to whatever matched — never
// to a fabricated value.
import { metaTag } from './html-meta';
import { safeFetchText } from './safe-fetch';
import { stripHashtags } from './extract-tiktok';

export type InstagramMeta = {
  title: string | null;
  description: string | null;
  thumbnail: string | null;
  publisher: string;
  author: string | null;
  publishedAt: string | null;
};

const PREVIEW_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

// Long enough for a real headline, short enough that a paragraph-long
// caption doesn't swamp the deck card. The full caption is still kept as the
// description.
const MAX_TITLE = 120;

/** "October 22, 2026" → "2026-10-22". Date only: Instagram's preview text
 *  carries no time or timezone, so a time would be invented. */
export function parsePostDate(raw: string): string | null {
  const m = raw.match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  const day = Number(m[2]);
  if (month < 0 || day < 1 || day > 31) return null;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** First line of the caption, hashtags stripped, cut at a word boundary. */
export function captionTitle(caption: string): string | null {
  const firstLine = caption.split('\n').map((l) => l.trim()).find(Boolean);
  if (!firstLine) return null;
  const clean = stripHashtags(firstLine) || firstLine;
  if (clean.length <= MAX_TITLE) return clean;
  const cut = clean.slice(0, MAX_TITLE);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > MAX_TITLE / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Pure parsing of a fetched Instagram page — split out from the fetch so it
 *  can be tested against real captured markup. */
export function parseInstagramHtml(html: string): InstagramMeta {
  // metaTag has already decoded entities.
  const tag = (name: string) => metaTag(html, name)?.trim() || null;
  const ogTitle = tag('og:title');
  const ogDescription = tag('og:description') || tag('description');
  const ogUrl = tag('og:url');

  // "… - username on Month D, YYYY" with an optional `: "caption"` tail.
  const desc = ogDescription?.match(
    /- ([A-Za-z0-9._]+) on ([A-Za-z]+ \d{1,2}, \d{4})(?:: "([\s\S]*)"\.?)?\s*$/,
  );
  // "Display Name on Instagram" with the same optional caption tail.
  const titled = ogTitle?.match(/^([\s\S]*?) on Instagram(?:: "([\s\S]*)")?$/);

  const caption = (desc?.[3] ?? titled?.[2])?.trim() || null;
  const username =
    desc?.[1] ?? ogUrl?.match(/instagram\.com\/([A-Za-z0-9._]+)\/(?:p|reels?|tv)\//)?.[1] ?? null;

  // Caption first; a caption-less post keeps Instagram's own "Name on
  // Instagram"; a profile or other page keeps its og:title as-is.
  const title = (caption && captionTitle(caption)) || ogTitle;

  return {
    title,
    description: caption,
    thumbnail: tag('og:image') || tag('twitter:image'),
    publisher: 'Instagram',
    author: username ? `@${username}` : null,
    publishedAt: desc ? parsePostDate(desc[2]) : null,
  };
}

/** Best-effort, never throws — a deleted or private post still yields
 *  whatever the page offered (often nothing), same contract as
 *  extractTikTok. */
export async function extractInstagram(url: string): Promise<InstagramMeta> {
  try {
    const { text } = await safeFetchText(url, {
      headers: {
        'User-Agent': PREVIEW_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
      maxBytes: 2 * 1024 * 1024,
      timeoutMs: 10000,
    });
    return parseInstagramHtml(text);
  } catch {
    return { title: null, description: null, thumbnail: null, publisher: 'Instagram', author: null, publishedAt: null };
  }
}
