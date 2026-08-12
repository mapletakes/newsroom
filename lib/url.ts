// Detect what kind of media a URL points to and normalize it for dedup.

export type MediaKind =
  | 'article'
  | 'youtube'
  | 'youtube_short'
  | 'youtube_playlist'
  | 'twitch_clip'
  | 'twitch_vod'
  | 'twitter'
  | 'tiktok'
  | 'unknown';

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'ref_src', 'ref_url',
  's', 'si', 'feature', // youtube share params
]);

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    // Strip tracking params
    const params = new URLSearchParams();
    for (const [k, v] of u.searchParams) {
      if (!TRACKING_PARAMS.has(k.toLowerCase())) params.append(k, v);
    }
    u.search = params.toString();
    // Lowercase host
    u.hostname = u.hostname.toLowerCase();
    // Strip trailing slash from path (but keep root)
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    // Strip fragment unless it's a YouTube timestamp (t=)
    if (!u.hash.startsWith('#t=')) u.hash = '';
    return u.toString();
  } catch {
    return raw.trim();
  }
}

// Strip playlist-related params (notably `list`, which can be an unlisted
// playlist ID) before posting a URL publicly to chat. Keeps the video id and
// timestamp.
export function sanitizeShareUrl(raw: string): string {
  const PLAYLIST_PARAMS = ['list', 'index', 'start_radio', 'pp', 'si'];
  try {
    const u = new URL(raw.trim());
    for (const p of PLAYLIST_PARAMS) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return raw;
  }
}

export function detectKind(url: string): MediaKind {
  let u: URL;
  try { u = new URL(url); } catch { return 'unknown'; }
  const h = u.hostname.replace(/^www\./, '');

  if (h === 'youtube.com' || h === 'm.youtube.com' || h === 'music.youtube.com') {
    if (u.searchParams.has('list') && !u.searchParams.has('v')) return 'youtube_playlist';
    if (u.pathname.startsWith('/shorts/')) return 'youtube_short';
    if (u.pathname.startsWith('/playlist')) return 'youtube_playlist';
    return 'youtube';
  }
  if (h === 'youtu.be') return 'youtube';
  if (h === 'twitch.tv' || h === 'clips.twitch.tv') {
    if (h === 'clips.twitch.tv' || u.pathname.includes('/clip/')) return 'twitch_clip';
    if (u.pathname.includes('/videos/')) return 'twitch_vod';
    return 'twitch_vod';
  }
  if (h === 'twitter.com' || h === 'x.com' || h === 'nitter.net') return 'twitter';
  if (h === 'tiktok.com' || h === 'vm.tiktok.com' || h === 'vt.tiktok.com') return 'tiktok';
  // Everything else is treated as an article candidate
  return 'article';
}

export function extractUrlsFromMessage(message: string): string[] {
  // Match http(s) URLs. Conservative regex.
  const regex = /https?:\/\/[^\s<>"'`]+/gi;
  const matches = message.match(regex) || [];
  return matches.map((m) => m.replace(/[.,;:!?)\]]+$/, ''));
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return '';
  return formatClock(seconds);
}

// Like formatDuration, but renders 0 as "0:00" instead of blank — for a
// running clock (elapsed-on-air) rather than a known fixed duration, where
// zero is a real, displayable value rather than "no duration known".
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Broad category for the deck's quick type filter.
export type KindCategory = 'video' | 'social' | 'article' | 'other';
export function kindCategory(kind: string): KindCategory {
  switch (kind) {
    case 'youtube':
    case 'youtube_short':
    case 'youtube_playlist':
    case 'twitch_clip':
    case 'twitch_vod':
      return 'video';
    case 'twitter':
    case 'tiktok':
      return 'social';
    case 'article':
      return 'article';
    default:
      return 'other';
  }
}

// Maps a media kind to a muted, type-coded card tint class (see globals.css).
export function kindTint(kind: string): string {
  switch (kind) {
    case 'youtube':
    case 'youtube_short':
    case 'youtube_playlist':
      return 'tint-youtube';
    case 'twitter':
      return 'tint-twitter';
    case 'article':
      return 'tint-article';
    case 'twitch_clip':
    case 'twitch_vod':
      return 'tint-twitch';
    case 'tiktok':
      return 'tint-tiktok';
    default:
      return 'tint-unknown';
  }
}

// Local date + time, e.g. "Jun 8, 2:34 PM".
export function formatDateTime(input: string | null | undefined): string {
  if (!input) return '';
  const d = new Date(input);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Short relative time, e.g. "just now", "5m ago", "3h ago", "2d ago".
export function relativeTime(input: string | null | undefined): string {
  if (!input) return '';
  const then = new Date(input).getTime();
  if (isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function formatDate(input: string | null | undefined): string {
  if (!input) return '';
  const d = new Date(input);
  if (isNaN(d.getTime())) return '';
  // Format in UTC so date-only values (e.g. "2023-05-14") don't shift a day.
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// Strips playlist context (list, index, start_radio, pp) from a URL that
// points at one specific YouTube video — called at ingestion (extension
// quick-add, chat submission, in-app add-by-URL), before the URL is ever
// stored or classified. Two problems, one fix: a stored URL carrying
// `list=` opens on YouTube's own site with the playlist sidebar showing (an
// unrelated/unlisted playlist gets exposed to whoever opens the link), and
// upstream code paths that treat a bare "list, no v" URL as a playlist to
// expand (see expandPlaylistWithMeta) have historically been the thing that
// misfires on one of these — stripping here removes the ambiguity instead
// of trying to keep every downstream check in sync.
//
// Deliberately narrow: only strips when the URL resolves to a specific
// video (extractYouTubeId finds one). A bare playlist URL — /playlist?list=…
// or /watch?list=… with no v — is left untouched, since `list` there isn't
// context to strip, it's the whole point of the link.
export function stripYouTubePlaylistContext(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const h = u.hostname.replace(/^www\./, '');
    const isYouTube = h === 'youtube.com' || h === 'm.youtube.com' || h === 'music.youtube.com' || h === 'youtu.be';
    if (!isYouTube) return raw;
    if (!extractYouTubeId(raw)) return raw;
    for (const p of ['list', 'index', 'start_radio', 'pp']) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return raw;
  }
}

export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '');
    if (h === 'youtu.be') return u.pathname.slice(1) || null;
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
    if (u.pathname.startsWith('/watch')) return u.searchParams.get('v');
    if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || null;
    return null;
  } catch { return null; }
}
