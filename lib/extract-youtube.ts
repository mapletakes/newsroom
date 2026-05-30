import { extractYouTubeId } from './url';

export type YouTubeMeta = {
  title: string | null;
  description: string | null;
  thumbnail: string | null;
  publisher: string | null; // channel name
  durationSeconds: number | null;
  publishedAt: string | null;
  transcript: string | null;
};

function parseISODuration(iso: string): number {
  // PT#H#M#S
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2] || '0', 10);
  const s = parseInt(m[3] || '0', 10);
  return h * 3600 + min * 60 + s;
}

export async function fetchYouTubeMeta(url: string): Promise<YouTubeMeta> {
  const id = extractYouTubeId(url);
  const empty: YouTubeMeta = {
    title: null, description: null, thumbnail: null,
    publisher: null, durationSeconds: null, publishedAt: null, transcript: null,
  };
  if (!id) return empty;

  const apiKey = process.env.YOUTUBE_API_KEY;
  let meta = { ...empty };

  if (apiKey) {
    try {
      const u = new URL('https://www.googleapis.com/youtube/v3/videos');
      u.searchParams.set('id', id);
      u.searchParams.set('part', 'snippet,contentDetails');
      u.searchParams.set('key', apiKey);
      const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
      const data = await r.json();
      const item = data?.items?.[0];
      if (item) {
        meta.title = item.snippet?.title || null;
        meta.description = item.snippet?.description?.slice(0, 800) || null;
        meta.thumbnail = item.snippet?.thumbnails?.maxres?.url
          || item.snippet?.thumbnails?.high?.url
          || item.snippet?.thumbnails?.default?.url
          || null;
        meta.publisher = item.snippet?.channelTitle || null;
        meta.publishedAt = item.snippet?.publishedAt || null;
        if (item.contentDetails?.duration) {
          meta.durationSeconds = parseISODuration(item.contentDetails.duration);
        }
      }
    } catch {
      // fall through to oEmbed
    }
  }

  if (!meta.title) {
    // oEmbed fallback (no API key needed)
    try {
      const r = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        { signal: AbortSignal.timeout(6000) },
      );
      if (r.ok) {
        const data = await r.json();
        meta.title = meta.title || data.title;
        meta.publisher = meta.publisher || data.author_name;
        meta.thumbnail = meta.thumbnail || data.thumbnail_url;
      }
    } catch {}
  }

  // Duration isn't available via oEmbed, so scrape the watch page when we still
  // don't have it (e.g. no API key). Also backfills any missing metadata.
  if (meta.durationSeconds == null) {
    const scraped = await scrapeWatchPageMeta(url);
    if (scraped) {
      meta.durationSeconds = meta.durationSeconds ?? scraped.durationSeconds ?? null;
      meta.title = meta.title || scraped.title || null;
      meta.publisher = meta.publisher || scraped.publisher || null;
      meta.thumbnail = meta.thumbnail || scraped.thumbnail || null;
      meta.description = meta.description || scraped.description || null;
    }
  }

  // Transcript (best-effort; fails silently)
  try {
    // Dynamic import to keep cold start light
    const { YoutubeTranscript } = await import('youtube-transcript');
    const items = await YoutubeTranscript.fetchTranscript(id);
    if (items && items.length) {
      meta.transcript = items.map((i: { text: string }) => i.text).join(' ').slice(0, 8000);
    }
  } catch {
    // transcript unavailable (most uploads outside major creators won't have one)
  }

  return meta;
}

export type PlaylistItem = {
  url: string;
  title: string | null;
  thumbnail: string | null;
  publisher: string | null;
  durationSeconds: number | null;
};

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function extractListId(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get('list');
  } catch { return null; }
}

// Extract the first balanced { ... } JSON object that follows a marker string.
// Used to pull ytInitialPlayerResponse out of a watch page (its end isn't a
// clean ";</script>", so brace-match instead).
function extractJsonAfter(html: string, marker: string): string | null {
  const m = html.indexOf(marker);
  if (m === -1) return null;
  const begin = html.indexOf('{', m + marker.length);
  if (begin === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = begin; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return html.substring(begin, i + 1);
    }
  }
  return null;
}

// Scrape a single video's watch page for metadata (notably duration) when the
// YouTube API key isn't available. No key needed.
async function scrapeWatchPageMeta(url: string): Promise<Partial<YouTubeMeta> | null> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const json = extractJsonAfter(await r.text(), 'ytInitialPlayerResponse');
    if (!json) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vd = (JSON.parse(json) as any)?.videoDetails;
    if (!vd) return null;
    const thumbs = vd.thumbnail?.thumbnails;
    const lenSecs = vd.lengthSeconds ? parseInt(vd.lengthSeconds, 10) : NaN;
    return {
      title: vd.title || null,
      publisher: vd.author || null,
      description: vd.shortDescription ? String(vd.shortDescription).slice(0, 800) : null,
      thumbnail: Array.isArray(thumbs) ? thumbs[thumbs.length - 1]?.url || null : null,
      durationSeconds: Number.isFinite(lenSecs) ? lenSecs : null,
    };
  } catch {
    return null;
  }
}

function scrapePlaylistItems(html: string): PlaylistItem[] {
  const marker = 'var ytInitialData = ';
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) return [];
  const jsonStart = startIdx + marker.length;
  const endIdx = html.indexOf(';</script>', jsonStart);
  if (endIdx === -1) return [];

  let data: Record<string, unknown>;
  try { data = JSON.parse(html.substring(jsonStart, endIdx)); } catch { return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tabs = (data as any)?.contents?.twoColumnBrowseResultsRenderer?.tabs;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const section = tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] =
    section?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents || [];

  const out: PlaylistItem[] = [];
  for (const item of items) {
    const v = item?.playlistVideoRenderer;
    if (!v?.videoId) continue;
    const thumbs = v.thumbnail?.thumbnails;
    const lenSecs = v.lengthSeconds ? parseInt(v.lengthSeconds, 10) : NaN;
    out.push({
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      title: v.title?.runs?.[0]?.text || null,
      thumbnail: Array.isArray(thumbs) ? thumbs[thumbs.length - 1]?.url || null : null,
      publisher: v.shortBylineText?.runs?.[0]?.text || null,
      durationSeconds: Number.isFinite(lenSecs) ? lenSecs : null,
    });
  }
  return out;
}

export async function expandPlaylistWithMeta(url: string): Promise<PlaylistItem[]> {
  const listId = extractListId(url);
  if (!listId) return [];

  try {
    const r = await fetch(`https://www.youtube.com/playlist?list=${listId}`, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return [];
    return scrapePlaylistItems(await r.text());
  } catch {
    return [];
  }
}

export async function expandPlaylist(url: string): Promise<string[]> {
  const items = await expandPlaylistWithMeta(url);
  return items.map((i) => i.url);
}
