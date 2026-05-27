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
};

export async function expandPlaylistWithMeta(url: string): Promise<PlaylistItem[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];
  let listId: string | null = null;
  try {
    const u = new URL(url);
    listId = u.searchParams.get('list');
  } catch { return []; }
  if (!listId) return [];

  const out: PlaylistItem[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 5; i++) {
    const u = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    u.searchParams.set('playlistId', listId);
    u.searchParams.set('part', 'snippet,contentDetails');
    u.searchParams.set('maxResults', '50');
    u.searchParams.set('key', apiKey);
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const r = await fetch(u);
    if (!r.ok) break;
    const data = await r.json();
    for (const item of data.items || []) {
      const vid = item?.contentDetails?.videoId;
      if (vid) {
        out.push({
          url: `https://www.youtube.com/watch?v=${vid}`,
          title: item?.snippet?.title || null,
          thumbnail: item?.snippet?.thumbnails?.high?.url
            || item?.snippet?.thumbnails?.default?.url || null,
          publisher: item?.snippet?.videoOwnerChannelTitle || null,
        });
      }
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

export async function expandPlaylist(url: string): Promise<string[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];
  let listId: string | null = null;
  try {
    const u = new URL(url);
    listId = u.searchParams.get('list');
  } catch { return []; }
  if (!listId) return [];

  const out: string[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 5; i++) { // cap at 250 items
    const u = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    u.searchParams.set('playlistId', listId);
    u.searchParams.set('part', 'contentDetails');
    u.searchParams.set('maxResults', '50');
    u.searchParams.set('key', apiKey);
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const r = await fetch(u);
    if (!r.ok) break;
    const data = await r.json();
    for (const item of data.items || []) {
      const vid = item?.contentDetails?.videoId;
      if (vid) out.push(`https://www.youtube.com/watch?v=${vid}`);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}
