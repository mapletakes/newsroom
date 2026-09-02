// hostDMCARisk is the only pure, testable piece of enrich.ts — enrichContent
// itself is a thin network/AI-call wrapper, same as the extractors, and
// isn't unit-tested here for the same reason none of them are (see
// extract-tiktok.test.ts's file comment).
import { describe, expect, it } from 'vitest';
import { hostDMCARisk } from './enrich';

describe('hostDMCARisk', () => {
  it('flags an exact high-risk host', () => {
    expect(hostDMCARisk('https://www.cnn.com/2026/09/some-story')).toBe('high');
    expect(hostDMCARisk('https://espn.com/nfl/story')).toBe('high');
  });

  it('flags a subdomain of a high-risk host', () => {
    expect(hostDMCARisk('https://video.foxnews.com/watch/123')).toBe('high');
  });

  it('does not flag a host that merely contains a high-risk host as a substring', () => {
    // "notcnn.com" is not "cnn.com" or a subdomain of it — a naive
    // .includes() check would wrongly match this.
    expect(hostDMCARisk('https://notcnn.com/story')).toBe('low');
  });

  it('never returns medium — an ordinary .com containing "news" or "media" is low, not a guess', () => {
    // The exact case this was fixed over: a small independent outlet whose
    // domain happens to contain one of those words used to get flagged
    // medium risk purely on that substring match.
    expect(hostDMCARisk('https://localnewsonline.com/story')).toBe('low');
    expect(hostDMCARisk('https://socialmediaexample.com/post')).toBe('low');
    expect(hostDMCARisk('https://www.mynewsblog.com/post')).toBe('low');
  });

  it('treats an ordinary, unlisted host as low risk', () => {
    expect(hostDMCARisk('https://example.com/article')).toBe('low');
    expect(hostDMCARisk('https://www.reuters.com/world/story')).toBe('low');
  });

  it('falls back to low on an unparseable URL rather than throwing', () => {
    expect(hostDMCARisk('not a url')).toBe('low');
  });
});
