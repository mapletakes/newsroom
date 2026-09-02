// Only the pure parsing logic is unit-tested here — extractTikTok() itself
// is a thin network I/O wrapper, same as every other extractor in this
// codebase (none of extract-article.ts/extract-youtube.ts/extract-twitter.ts
// have a test file either). What's worth pinning down is the JSON traversal
// and text cleanup, which is where the real bugs live.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractTikTok,
  extractVideoItem,
  itemAuthor,
  itemDurationSeconds,
  itemPublishedAt,
  itemThumbnail,
  stripHashtags,
} from './extract-tiktok';

afterEach(() => vi.unstubAllGlobals());

// A trimmed but structurally real shape of TikTok's own rehydration blob.
function pageWith(itemStruct: unknown): string {
  const payload = {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': {
        itemInfo: { itemStruct },
      },
    },
  };
  return `<html><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify(payload)}</script></body></html>`;
}

describe('extractVideoItem', () => {
  it('finds and parses the itemStruct out of a real-shaped page', () => {
    const html = pageWith({ desc: 'a caption', createTime: 1700000000 });
    expect(extractVideoItem(html)).toEqual({ desc: 'a caption', createTime: 1700000000 });
  });

  it('returns null when the script tag is absent — a photo post or profile page, not a video', () => {
    expect(extractVideoItem('<html><body>no rehydration data here</body></html>')).toBeNull();
  });

  it('returns null on malformed JSON rather than throwing', () => {
    const html = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{not valid json</script>';
    expect(extractVideoItem(html)).toBeNull();
  });

  it('returns null when the expected shape has moved (TikTok reshaped the page)', () => {
    const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({ somethingElse: true })}</script>`;
    expect(extractVideoItem(html)).toBeNull();
  });
});

describe('itemDurationSeconds', () => {
  it('reads video.duration, rounding to a whole second', () => {
    expect(itemDurationSeconds({ video: { duration: 42.6 } })).toBe(43);
  });

  it('falls back to a top-level duration field', () => {
    expect(itemDurationSeconds({ duration: 17 })).toBe(17);
  });

  it('treats a zero or missing duration as unknown, not a real zero-second video', () => {
    expect(itemDurationSeconds({ video: { duration: 0 } })).toBeNull();
    expect(itemDurationSeconds({})).toBeNull();
    expect(itemDurationSeconds(null)).toBeNull();
  });
});

describe('itemPublishedAt', () => {
  it('converts createTime (Unix seconds) to an ISO string', () => {
    expect(itemPublishedAt({ createTime: 1700000000 })).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('falls back to createTimeISO when createTime is absent', () => {
    expect(itemPublishedAt({ createTimeISO: '2023-11-14T00:00:00.000Z' })).toBe('2023-11-14T00:00:00.000Z');
  });

  it('is null, never a fabricated "now", when no real date is available', () => {
    // This is the specific bug the draft PR had: it stamped
    // new Date().toISOString() here, presenting a guess as a fact.
    expect(itemPublishedAt({})).toBeNull();
    expect(itemPublishedAt(null)).toBeNull();
  });
});

describe('itemAuthor', () => {
  it('prefers the @handle over the display name', () => {
    expect(itemAuthor({ author: { uniqueId: 'realuser', nickname: 'Real User' } })).toBe('@realuser');
  });

  it('falls back to the display name when there is no handle', () => {
    expect(itemAuthor({ author: { nickname: 'Real User' } })).toBe('Real User');
  });

  it('is null rather than an empty string when nothing is available', () => {
    expect(itemAuthor({})).toBeNull();
    expect(itemAuthor(null)).toBeNull();
  });
});

describe('itemThumbnail', () => {
  it('prefers originCover over cover', () => {
    expect(itemThumbnail({ video: { originCover: 'a.jpg', cover: 'b.jpg' } })).toBe('a.jpg');
  });

  it('falls back to cover', () => {
    expect(itemThumbnail({ video: { cover: 'b.jpg' } })).toBe('b.jpg');
  });

  it('is null when neither is present', () => {
    expect(itemThumbnail({})).toBeNull();
  });
});

describe('extractTikTok — the actual regression this was rewritten over', () => {
  // The reference PR's extractor threw for anything that wasn't a canonical
  // /@user/video/id page (hashtag pages, sound pages, photo posts) — a
  // caption/thumbnail from OG tags is worse than a full extraction, but it's
  // strictly better than the "extraction failed" mod-notes state a throw
  // produces. This is that exact scenario: a page with OG tags but no
  // __UNIVERSAL_DATA_FOR_REHYDRATION__ script at all.
  it('degrades to OG-tag data instead of throwing when the page is not a video page', async () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Weekly news roundup #politics">
        <meta property="og:image" content="https://example.com/thumb.jpg">
        <meta property="og:site_name" content="TikTok">
      </head></html>
    `;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/oembed')) return Promise.resolve(new Response('{}', { status: 404 }));
        return Promise.resolve(new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }));
      }),
    );

    const meta = await extractTikTok('https://www.tiktok.com/tag/news');

    expect(meta.title).toBe('Weekly news roundup'); // hashtag stripped
    expect(meta.thumbnail).toBe('https://example.com/thumb.jpg');
    expect(meta.durationSeconds).toBeNull(); // honestly unknown, not 0
    expect(meta.publishedAt).toBeNull(); // honestly unknown, not "now"
  });

  it('returns the empty shape rather than throwing when the fetch itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network error'))));
    const meta = await extractTikTok('https://www.tiktok.com/@someone/video/123');
    expect(meta).toEqual({
      title: null,
      description: null,
      thumbnail: null,
      publisher: null,
      author: null,
      publishedAt: null,
      durationSeconds: null,
    });
  });
});

describe('stripHashtags', () => {
  it('removes hashtags and collapses the resulting whitespace', () => {
    expect(stripHashtags('Check this out #fyp #viral #politics')).toBe('Check this out');
  });

  it('leaves an ordinary caption untouched', () => {
    expect(stripHashtags('A perfectly normal caption')).toBe('A perfectly normal caption');
  });

  it('does not strip a mid-word hash-adjacent character, only real hashtags', () => {
    expect(stripHashtags('C# tutorial #coding')).toBe('C# tutorial');
  });
});
