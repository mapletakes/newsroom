export type TiktokMeta = {
  title: string;
  description: string;
  thumbnail: string;
  publisher: string;
  author: string;
  publishedAt: string;
  durationSeconds: number;
  transcript: string | null;
};



function cleanTitle(raw: string): string {
  if (!raw) return raw;

  // Remove hashtags
  let title = raw.replace(/#\S+/g, '');

  // Clean up extra spaces that may remain after removing hashtags
  title = title.replace(/\s+/g, ' ').trim();

  // Optionally strip trailing punctuation artifacts like " | TikTok"
  title = title.replace(/\s*\|\s*TikTok\s*$/i, '').trim();

  return title;
}

async function fetchText(url: string, accept = 'text/html'): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: accept,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return text;
}

async function fetchOembed(url: string): Promise<Record<string, unknown> | null> {
  const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
  try {
    const text = await fetchText(oembedUrl, 'application/json');
    const data = JSON.parse(text) as Record<string, unknown>;
    return data;
  } catch (err) {
    return null;
  }
}

function parseOpenGraph(html: string): Record<string, string> {
  const og: Record<string, string> = {};
  const metaOg = html.matchAll(
    /<meta\s+(?:property|name)\s*=\s*["']([^"']+)["']\s+content\s*=\s*["']([^"']+)["']\s*\/?>/gi
  );
  for (const m of metaOg) {
    const [, rawKey, value] = m;
    if (!rawKey || !value) continue;
    const key = rawKey.toLowerCase();
    if (key.startsWith('og:') || key.startsWith('twitter:')) {
      og[key] = value;
    }
  }
  return og;
}

function extractUniversalDataJson(html: string): Record<string, unknown> | null {
  const scriptMatch = html.match(
    /<script[^>]*id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!scriptMatch) {
    return null;
  }

  const jsonStr = scriptMatch[1];

  try {
    const data = JSON.parse(jsonStr) as Record<string, unknown>;
    return data;
  } catch (err) {
    return null;
  }
}

function traverseToVideoItem(data: Record<string, unknown>): Record<string, unknown> | null {
  const defaultScope = data.__DEFAULT_SCOPE__ as Record<string, unknown> | undefined;
  if (!defaultScope) {
    return null;
  }

  const videoDetail = (defaultScope as Record<string, unknown>)[
    'webapp.video-detail'
  ] as Record<string, unknown> | undefined;

  if (!videoDetail) {
    return null;
  }

  const itemInfo = videoDetail.itemInfo as Record<string, unknown> | undefined;
  if (!itemInfo) {
    return null;
  }

  const itemStruct = itemInfo.itemStruct as Record<string, unknown> | undefined;
  if (!itemStruct) {
    return null;
  }

  return itemStruct;
}

function extractDuration(itemStruct: Record<string, unknown>): number | null {
  const video = itemStruct.video as Record<string, unknown> | undefined;
  if (video) {
    const dur = video.duration as number | undefined;
    if (typeof dur === 'number' && dur > 0) {
      return Math.round(dur);
    }
  }

  const directDur = itemStruct.duration as number | undefined;
  if (typeof directDur === 'number' && directDur > 0) {
    return Math.round(directDur);
  }

  return null;
}

function extractPublishedAt(itemStruct: Record<string, unknown>): string | null {
  const createTime = itemStruct.createTime as number | undefined;
  if (typeof createTime === 'number' && createTime > 0) {
    const date = new Date(createTime * 1000);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  const createTimeISO = itemStruct.createTimeISO as string | undefined;
  if (createTimeISO) {
    return createTimeISO;
  }

  return null;
}

function extractAuthor(itemStruct: Record<string, unknown>): string | null {
  const author = itemStruct.author as Record<string, unknown> | undefined;
  if (!author) {
    return null;
  }

  const uniqueId = author.uniqueId as string | undefined;
  const nickname = author.nickname as string | undefined;

  if (uniqueId) {
    const handle = `@${uniqueId}`;
    return handle;
  }

  if (nickname) {
    return nickname;
  }
  return null;
}

function extractTitleAndDescription(
  itemStruct: Record<string, unknown>,
  og: Record<string, string>
): { title: string; description: string } {
  const desc = itemStruct.desc as string | undefined;
  let description = desc ?? og['og:description'] ?? og['twitter:description'] ?? '';

  let title = og['og:title'] ?? og['twitter:title'] ?? description ?? '';
  if (!title && desc) {
    title = desc;
  }

  // Clean title: remove hashtags, normalize spaces, strip " | TikTok"
  const clean = cleanTitle(title);

  return { title: clean, description };
}

function extractThumbnail(
  itemStruct: Record<string, unknown>,
  og: Record<string, string>
): string {
  const ogImage = og['og:image'] || og['twitter:image'];
  if (ogImage) {
    return ogImage;
  }

  const video = itemStruct.video as Record<string, unknown> | undefined;
  if (video) {
    const originCover = video.originCover as string | undefined;
    const cover = video.cover as string | undefined;
    if (originCover) {
      return originCover;
    }
    if (cover) {
      return cover;
    }
  }

  return '';
}

export async function extractTikTok(
  url: string,
): Promise<TiktokMeta> {

  const normalizedUrl = url.trim();
  if (!/^https?:\/\/(www\.)?tiktok\.com\//i.test(normalizedUrl)) {
    throw new Error('Invalid TikTok URL');
  }

  // 1. Try oEmbed
  const oembedData = await fetchOembed(normalizedUrl);

  // 2. Fetch HTML
  const html = await fetchText(normalizedUrl);

  // 3. Parse Open Graph
  const og = parseOpenGraph(html);

  // 4. Parse rehydration JSON
  const jsonData = extractUniversalDataJson(html);
  const itemStruct = jsonData ? traverseToVideoItem(jsonData) : null;

  // 5. Extract fields, preferring itemStruct, then OG, then oEmbed

  let title = '';
  let description = '';
  let thumbnail = '';
  let author = '';
  let publishedAt = '';
  let durationSeconds = 0;

  if (itemStruct) {
    const td = extractTitleAndDescription(itemStruct, og);
    title = td.title;          // already cleaned (no hashtags)
    description = td.description; // keep hashtags

    thumbnail = extractThumbnail(itemStruct, og);

    const authorVal = extractAuthor(itemStruct);
    author = authorVal ?? '';

    const pub = extractPublishedAt(itemStruct);
    publishedAt = pub ?? new Date().toISOString();

    const dur = extractDuration(itemStruct);
    durationSeconds = dur ?? 0;
  } else {
    // Fallback to OG + oEmbed

    const rawTitle =
      og['og:title'] ??
      og['twitter:title'] ??
      (oembedData?.title as string) ??
      '';

    title = cleanTitle(rawTitle);

    description =
      og['og:description'] ??
      og['twitter:description'] ??
      (oembedData?.title as string) ??
      '';

    thumbnail =
      og['og:image'] ??
      og['twitter:image'] ??
      (oembedData?.thumbnail_url as string) ??
      '';

    const authorFromOg = og['article:author'];
    const authorFromOembed = oembedData?.author_name as string | undefined;

    if (authorFromOg) {
      author = authorFromOg;
    } else if (authorFromOembed) {
      author = authorFromOembed;
    } else {
      const urlMatch = normalizedUrl.match(/tiktok\.com\/@([^/?]+)/i);
      author = urlMatch ? `@${urlMatch[1]}` : '';
    }

    publishedAt = new Date().toISOString();
    durationSeconds = 0;
  }

  const publisher =
    og['og:site_name'] ??
    (oembedData?.provider_name as string) ??
    'TikTok';

  const transcript: string | null = null;

  const result: TiktokMeta = {
    title,
    description,
    thumbnail,
    publisher,
    author,
    publishedAt,
    durationSeconds,
    transcript,
  };
  return result;
}