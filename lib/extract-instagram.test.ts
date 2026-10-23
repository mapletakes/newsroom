// Pure parsing only, same as extract-tiktok.test.ts — the fixtures are the
// OG tags Instagram actually served its preview crawler for two real posts
// (Oct 2026), trimmed to the tags the parser reads.

import { describe, expect, it } from 'vitest';
import { captionTitle, parseInstagramHtml, parsePostDate } from './extract-instagram';

const CAPTIONED = `
<meta property="og:title" content="The H3 Podcast on Instagram: &quot;a message from the crew...&quot;" />
<meta property="og:image" content="https://scontent.cdninstagram.com/v/t39/848110705_n.jpg?stp=dst-jpg&amp;_nc_cat=1&amp;oe=6A0C1F4D" />
<meta property="og:url" content="https://www.instagram.com/h3_podcast/p/De05Eaho7nD/" />
<meta property="og:description" content="100K likes, 5,331 comments - h3_podcast on October 22, 2026: &quot;a message from the crew...&quot;. " />
<meta name="twitter:title" content="The H3 Podcast (&#064;h3_podcast) &#x2022; Instagram photos and videos" />
<title>Instagram</title>`;

const NO_CAPTION = `
<meta property="og:title" content="Hila Klein on Instagram" />
<meta property="og:url" content="https://www.instagram.com/kleinhila/p/De00ijxjhPR/" />
<meta property="og:description" content="214K likes, 0 comments - kleinhila on October 22, 2026" />
<title>Instagram</title>`;

describe('parseInstagramHtml', () => {
  it('uses the caption as the title, with account, date and decoded image URL', () => {
    expect(parseInstagramHtml(CAPTIONED)).toEqual({
      title: 'a message from the crew...',
      description: 'a message from the crew...',
      thumbnail: 'https://scontent.cdninstagram.com/v/t39/848110705_n.jpg?stp=dst-jpg&_nc_cat=1&oe=6A0C1F4D',
      publisher: 'Instagram',
      author: '@h3_podcast',
      publishedAt: '2026-10-22',
    });
  });

  it("keeps Instagram's own \"Name on Instagram\" title for a post with no caption", () => {
    const meta = parseInstagramHtml(NO_CAPTION);
    expect(meta.title).toBe('Hila Klein on Instagram');
    expect(meta.description).toBeNull();
    expect(meta.author).toBe('@kleinhila');
    expect(meta.publishedAt).toBe('2026-10-22');
  });

  it('keeps a caption containing quotes and apostrophes intact', () => {
    const html =
      '<meta property="og:description" content="5 likes, 1 comments - someone on March 3, 2026: &quot;it&#039;s &quot;live&quot; now&quot;. " />';
    expect(parseInstagramHtml(html).description).toBe('it\'s "live" now');
  });

  it('falls back to og:url for the account when the description is missing', () => {
    const html = '<meta property="og:url" content="https://www.instagram.com/someone/reel/abc123/" />';
    expect(parseInstagramHtml(html).author).toBe('@someone');
  });

  it('returns nulls (not "Instagram") for the login-wall shell a browser UA gets', () => {
    const meta = parseInstagramHtml('<html><head><title>Instagram</title></head></html>');
    expect(meta.title).toBeNull();
    expect(meta.author).toBeNull();
    expect(meta.thumbnail).toBeNull();
  });

  it('keeps a profile page title as-is', () => {
    const html = '<meta property="og:title" content="NASA (&#064;nasa) &#x2022; Instagram photos and videos" />';
    expect(parseInstagramHtml(html).title).toBe('NASA (@nasa) • Instagram photos and videos');
  });
});

describe('captionTitle', () => {
  it('takes the first non-empty line and strips hashtags', () => {
    expect(captionTitle('\nbig news today #politics #fyp\nmore below')).toBe('big news today');
  });

  it('cuts long captions at a word boundary', () => {
    const title = captionTitle(`${'word '.repeat(40)}end`)!;
    expect(title.length).toBeLessThanOrEqual(121);
    expect(title.endsWith('word…')).toBe(true);
  });

  it('keeps an all-hashtag line rather than returning nothing', () => {
    expect(captionTitle('#tbt')).toBe('#tbt');
  });
});

describe('parsePostDate', () => {
  it('parses the en-US date Instagram prints', () => {
    expect(parsePostDate('March 3, 2026')).toBe('2026-03-03');
  });

  it('returns null for anything else rather than guessing', () => {
    expect(parsePostDate('3 March 2026')).toBeNull();
    expect(parsePostDate('Smarch 3, 2026')).toBeNull();
  });
});
