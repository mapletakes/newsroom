import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  sanitizeShareUrl,
  detectKind,
  extractUrlsFromMessage,
  stripYouTubePlaylistContext,
} from './url';

describe('normalizeUrl', () => {
  it('strips known tracking params (case-insensitively)', () => {
    expect(normalizeUrl('https://example.com/a?utm_source=twitter&id=5')).toBe(
      'https://example.com/a?id=5',
    );
    expect(normalizeUrl('https://example.com/a?UTM_Source=twitter&id=5')).toBe(
      'https://example.com/a?id=5',
    );
  });

  it('lowercases the host but not the path', () => {
    expect(normalizeUrl('https://EXAMPLE.com/Some-Path')).toBe('https://example.com/Some-Path');
  });

  it('strips a trailing slash but keeps the root path', () => {
    expect(normalizeUrl('https://example.com/foo/')).toBe('https://example.com/foo');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('strips the fragment unless it is a YouTube timestamp', () => {
    expect(normalizeUrl('https://youtu.be/abc#foo')).toBe('https://youtu.be/abc');
    expect(normalizeUrl('https://youtu.be/abc#t=30')).toBe('https://youtu.be/abc#t=30');
  });

  it('dedups a real-world YouTube share link down to its canonical form', () => {
    expect(normalizeUrl('https://youtube.com/watch?v=abc123&si=xyz&feature=share')).toBe(
      'https://youtube.com/watch?v=abc123',
    );
  });

  it('falls back to the trimmed raw string for an unparseable URL', () => {
    expect(normalizeUrl('  not a url  ')).toBe('not a url');
  });
});

describe('sanitizeShareUrl', () => {
  it('strips playlist-related params but keeps video id and timestamp', () => {
    expect(sanitizeShareUrl('https://youtube.com/watch?v=abc&list=PLxyz&index=3&t=30s')).toBe(
      'https://youtube.com/watch?v=abc&t=30s',
    );
  });

  it('returns the raw string untrimmed for an unparseable URL (unlike normalizeUrl)', () => {
    expect(sanitizeShareUrl('  not a url  ')).toBe('  not a url  ');
  });
});

describe('stripYouTubePlaylistContext', () => {
  it('strips list/index/start_radio/pp from a video URL that also carries them', () => {
    expect(
      stripYouTubePlaylistContext('https://www.youtube.com/watch?v=abc&list=PLxyz&index=3&start_radio=1&pp=abc'),
    ).toBe('https://www.youtube.com/watch?v=abc');
  });

  it('leaves a bare playlist URL (no specific video) untouched', () => {
    expect(stripYouTubePlaylistContext('https://www.youtube.com/playlist?list=PLxyz')).toBe(
      'https://www.youtube.com/playlist?list=PLxyz',
    );
    expect(stripYouTubePlaylistContext('https://www.youtube.com/watch?list=PLxyz')).toBe(
      'https://www.youtube.com/watch?list=PLxyz',
    );
  });

  it('strips from a youtu.be short link (video id in the path, not a v param)', () => {
    expect(stripYouTubePlaylistContext('https://youtu.be/abc?list=PLxyz&t=30')).toBe(
      'https://youtu.be/abc?t=30',
    );
  });

  it('strips from a Shorts URL', () => {
    expect(stripYouTubePlaylistContext('https://www.youtube.com/shorts/abc?list=PLxyz')).toBe(
      'https://www.youtube.com/shorts/abc',
    );
  });

  it('keeps a timestamp param alongside the stripped playlist params', () => {
    expect(stripYouTubePlaylistContext('https://youtube.com/watch?v=abc&list=PLxyz&t=90s')).toBe(
      'https://youtube.com/watch?v=abc&t=90s',
    );
  });

  it('leaves non-YouTube URLs untouched', () => {
    expect(stripYouTubePlaylistContext('https://example.com/a?list=1')).toBe(
      'https://example.com/a?list=1',
    );
  });

  it('returns the raw string untrimmed for an unparseable URL', () => {
    expect(stripYouTubePlaylistContext('  not a url  ')).toBe('  not a url  ');
  });
});

describe('detectKind', () => {
  it('classifies YouTube watch, shorts, and playlist URLs', () => {
    expect(detectKind('https://www.youtube.com/watch?v=abc')).toBe('youtube');
    expect(detectKind('https://m.youtube.com/shorts/abc')).toBe('youtube_short');
    expect(detectKind('https://youtube.com/playlist?list=PLxyz')).toBe('youtube_playlist');
    expect(detectKind('https://youtu.be/abc')).toBe('youtube');
  });

  it('treats a watch URL that also carries a list param as a video, not a playlist', () => {
    // Has both v and list — v wins per the has(list) && !has(v) check.
    expect(detectKind('https://youtube.com/watch?v=abc&list=PLxyz')).toBe('youtube');
  });

  it('classifies Twitch clips vs VODs', () => {
    expect(detectKind('https://clips.twitch.tv/SomeClipName')).toBe('twitch_clip');
    expect(detectKind('https://www.twitch.tv/someuser/clip/abc')).toBe('twitch_clip');
    expect(detectKind('https://www.twitch.tv/someuser/videos/12345')).toBe('twitch_vod');
  });

  it('classifies Twitter/X and TikTok', () => {
    expect(detectKind('https://twitter.com/user/status/1')).toBe('twitter');
    expect(detectKind('https://x.com/user/status/1')).toBe('twitter');
    expect(detectKind('https://www.tiktok.com/@user/video/123')).toBe('tiktok');
  });

  it('falls back to article for everything else, and unknown for unparseable input', () => {
    expect(detectKind('https://example.com/some-article')).toBe('article');
    expect(detectKind('not a url')).toBe('unknown');
  });
});

describe('extractUrlsFromMessage', () => {
  it('extracts a bare URL', () => {
    expect(extractUrlsFromMessage('check this out https://example.com/foo')).toEqual([
      'https://example.com/foo',
    ]);
  });

  it('strips trailing punctuation that is not part of the URL', () => {
    expect(extractUrlsFromMessage('cool link: https://example.com/foo!')).toEqual([
      'https://example.com/foo',
    ]);
    expect(extractUrlsFromMessage('(see https://example.com/foo)')).toEqual([
      'https://example.com/foo',
    ]);
  });

  it('extracts multiple URLs from one message', () => {
    expect(
      extractUrlsFromMessage('https://a.com/1 and also https://b.com/2'),
    ).toEqual(['https://a.com/1', 'https://b.com/2']);
  });

  it('returns an empty array when there is no URL', () => {
    expect(extractUrlsFromMessage('no links here')).toEqual([]);
  });
});
