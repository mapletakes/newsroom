import { extractYouTubeId } from './url';
import { safeFetchText } from './safe-fetch';

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
  const meta = { ...empty };

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
      meta.publishedAt = meta.publishedAt || scraped.publishedAt || null;
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
    // Host here is always youtube.com/youtu.be — detectKind already
    // confirmed that before this was ever called — so safeFetchText's SSRF
    // guard is a formality; the size cap is the part that actually earns
    // its keep, bounding a watch page's often-hefty inline JSON.
    const r = await safeFetchText(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'SOCS=CAI; CONSENT=YES+1',
      },
      maxBytes: 5 * 1024 * 1024,
      timeoutMs: 10000,
    });
    if (r.status < 200 || r.status >= 300) return null;
    const json = extractJsonAfter(r.text, 'ytInitialPlayerResponse');
    if (!json) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = JSON.parse(json) as any;
    const vd = data?.videoDetails;
    if (!vd) return null;
    const micro = data?.microformat?.playerMicroformatRenderer;
    const thumbs = vd.thumbnail?.thumbnails;
    const lenSecs = vd.lengthSeconds ? parseInt(vd.lengthSeconds, 10) : NaN;
    return {
      title: vd.title || null,
      publisher: vd.author || null,
      description: vd.shortDescription ? String(vd.shortDescription).slice(0, 800) : null,
      thumbnail: Array.isArray(thumbs) ? thumbs[thumbs.length - 1]?.url || null : null,
      durationSeconds: Number.isFinite(lenSecs) ? lenSecs : null,
      publishedAt: micro?.publishDate || micro?.uploadDate || null,
    };
  } catch {
    return null;
  }
}

// Pull the ytInitialData JSON blob, trying the assignment forms YouTube uses.
function extractYtInitialData(html: string): string | null {
  for (const marker of ['var ytInitialData = ', 'window["ytInitialData"] = ', 'ytInitialData = ']) {
    const json = extractJsonAfter(html, marker);
    if (json) return json;
  }
  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Recursively collect every playlistVideoRenderer in the data, so we don't
// depend on YouTube's exact navigation path (which changes periodically).
function collectPlaylistVideos(node: any, out: PlaylistItem[], seen: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectPlaylistVideos(n, out, seen);
    return;
  }
  const v = node.playlistVideoRenderer;
  if (v?.videoId && !seen.has(v.videoId)) {
    seen.add(v.videoId);
    const thumbs = v.thumbnail?.thumbnails;
    const lenSecs = v.lengthSeconds ? parseInt(v.lengthSeconds, 10) : NaN;
    out.push({
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      title: v.title?.runs?.[0]?.text || v.title?.simpleText || null,
      thumbnail: Array.isArray(thumbs) ? thumbs[thumbs.length - 1]?.url || null : null,
      publisher: v.shortBylineText?.runs?.[0]?.text || null,
      durationSeconds: Number.isFinite(lenSecs) ? lenSecs : null,
    });
  }
  for (const k in node) {
    if (k === 'playlistVideoRenderer') continue;
    collectPlaylistVideos(node[k], out, seen);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function scrapePlaylistItems(html: string): PlaylistItem[] {
  const json = extractYtInitialData(html);
  if (!json) return [];
  let data: unknown;
  try { data = JSON.parse(json); } catch { return []; }
  const out: PlaylistItem[] = [];
  collectPlaylistVideos(data, out, new Set());
  return out;
}

// API-first playlist expansion (reliable from datacenter IPs), falling back to
// HTML scraping when there's no key or the API errors.
export async function expandPlaylistWithMeta(url: string): Promise<PlaylistItem[]> {
  const listId = extractListId(url);
  if (!listId) return [];

  if (process.env.YOUTUBE_API_KEY) {
    const viaApi = await expandPlaylistViaApi(listId);
    if (viaApi.length > 0) return viaApi;
  }
  return scrapePlaylist(listId);
}

async function scrapePlaylist(listId: string): Promise<PlaylistItem[]> {
  try {
    // A long playlist's ytInitialData blob can run several megabytes — the
    // cap here is what actually matters (host is fixed to youtube.com, so
    // the SSRF guard is a formality, same as scrapeWatchPageMeta above).
    const r = await safeFetchText(`https://www.youtube.com/playlist?list=${listId}&hl=en`, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        // Skip the EU consent interstitial that otherwise replaces the page.
        Cookie: 'SOCS=CAI; CONSENT=YES+1',
      },
      maxBytes: 10 * 1024 * 1024,
      timeoutMs: 12000,
    });
    if (r.status < 200 || r.status >= 300) return [];
    return scrapePlaylistItems(r.text);
  } catch {
    return [];
  }
}

// Expand a playlist via the YouTube Data API: playlistItems for the list, then
// videos.list (batched) for durations.
async function expandPlaylistViaApi(listId: string): Promise<PlaylistItem[]> {
  const key = process.env.YOUTUBE_API_KEY!;
  try {
    const raw: { videoId: string; title: string | null; thumbnail: string | null; publisher: string | null }[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const u = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      u.searchParams.set('part', 'snippet,contentDetails');
      u.searchParams.set('maxResults', '50');
      u.searchParams.set('playlistId', listId);
      u.searchParams.set('key', key);
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return []; // let the caller fall back to scraping
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await r.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const it of data.items || []) {
        const vid = it.contentDetails?.videoId || it.snippet?.resourceId?.videoId;
        const title = it.snippet?.title;
        // Skip private/deleted entries.
        if (!vid || title === 'Private video' || title === 'Deleted video') continue;
        const thumbs = it.snippet?.thumbnails;
        raw.push({
          videoId: vid,
          title: title || null,
          thumbnail:
            thumbs?.maxres?.url || thumbs?.high?.url || thumbs?.medium?.url || thumbs?.default?.url || null,
          publisher: it.snippet?.videoOwnerChannelTitle || it.snippet?.channelTitle || null,
        });
      }
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    if (raw.length === 0) return [];

    // Durations come from videos.list (batched 50 at a time).
    const durations = new Map<string, number>();
    for (let i = 0; i < raw.length; i += 50) {
      const ids = raw.slice(i, i + 50).map((x) => x.videoId).join(',');
      const u = new URL('https://www.googleapis.com/youtube/v3/videos');
      u.searchParams.set('part', 'contentDetails');
      u.searchParams.set('id', ids);
      u.searchParams.set('key', key);
      const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await r.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const it of data.items || []) {
        if (it.id && it.contentDetails?.duration) {
          durations.set(it.id, parseISODuration(it.contentDetails.duration));
        }
      }
    }

    return raw.map((x) => ({
      url: `https://www.youtube.com/watch?v=${x.videoId}`,
      title: x.title,
      thumbnail: x.thumbnail,
      publisher: x.publisher,
      durationSeconds: durations.get(x.videoId) ?? null,
    }));
  } catch {
    return [];
  }
}

export async function expandPlaylist(url: string): Promise<string[]> {
  const items = await expandPlaylistWithMeta(url);
  return items.map((i) => i.url);
}
