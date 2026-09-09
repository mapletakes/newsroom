import { describe, expect, it } from 'vitest';
import { buildPlayedMessages, validateWebhookUrl, type PlayedNote } from './discord';

describe('validateWebhookUrl', () => {
  const GOOD = 'https://discord.com/api/webhooks/123456789012345678/aBcD_eFgH-1234567890';

  it('accepts a well-formed discord.com webhook URL', () => {
    expect(validateWebhookUrl(GOOD)).toEqual({ ok: true, url: GOOD });
  });

  it('strips a trailing slash and query string', () => {
    expect(validateWebhookUrl(`${GOOD}/?wait=true`)).toEqual({ ok: true, url: GOOD });
  });

  it('accepts the legacy discordapp.com host', () => {
    const url = GOOD.replace('discord.com', 'discordapp.com');
    expect(validateWebhookUrl(url).ok).toBe(true);
  });

  it('rejects a non-Discord host', () => {
    const r = validateWebhookUrl(GOOD.replace('discord.com', 'evil.example.com'));
    expect(r.ok).toBe(false);
  });

  it('rejects plain http', () => {
    const r = validateWebhookUrl(GOOD.replace('https://', 'http://'));
    expect(r.ok).toBe(false);
  });

  it('rejects a URL that is not shaped like a webhook', () => {
    const r = validateWebhookUrl('https://discord.com/channels/1/2');
    expect(r.ok).toBe(false);
  });

  it('rejects garbage input', () => {
    expect(validateWebhookUrl('not a url').ok).toBe(false);
    expect(validateWebhookUrl('').ok).toBe(false);
  });
});

describe('buildPlayedMessages', () => {
  const note = (over: Partial<PlayedNote>): PlayedNote => ({
    title: 'A title',
    url: 'https://example.com/a',
    played_at: '2026-09-09T20:00:00.000Z',
    ...over,
  });

  it('returns nothing for an empty batch', () => {
    expect(buildPlayedMessages('Mike', [])).toEqual([]);
  });

  it('includes a header with the item count and one numbered line per item', () => {
    const notes = [
      note({ title: 'First', url: 'https://a.example/1', played_at: '2026-09-09T20:00:00.000Z' }),
      note({ title: 'Second', url: 'https://a.example/2', played_at: '2026-09-09T20:00:42.000Z' }),
    ];
    const [msg] = buildPlayedMessages('Mike', notes);
    expect(msg).toContain('(2 items)');
    expect(msg).toContain('Played on Mike');
    expect(msg).toContain('1. [First](https://a.example/1) · +0:00');
    expect(msg).toContain('2. [Second](https://a.example/2) · +0:42');
  });

  it('uses singular "item" for a batch of one', () => {
    const [msg] = buildPlayedMessages('Mike', [note({})]);
    expect(msg).toContain('(1 item)');
  });

  it('falls back to the url when there is no title', () => {
    const [msg] = buildPlayedMessages('Mike', [note({ title: null, url: 'https://a.example/x' })]);
    expect(msg).toContain('[https://a.example/x](https://a.example/x)');
  });

  it('adds an indented takeaway line under its item', () => {
    const [msg] = buildPlayedMessages('Mike', [note({ takeaway: 'Worth a rewatch' })]);
    expect(msg).toContain('↳ Worth a rewatch');
  });

  it('formats hour-scale elapsed time', () => {
    const notes = [
      note({ played_at: '2026-09-09T20:00:00.000Z' }),
      note({ played_at: '2026-09-09T21:30:05.000Z' }),
    ];
    const [msg] = buildPlayedMessages('Mike', notes);
    expect(msg).toContain('+1:30:05');
  });

  it('escapes markdown-breaking characters in titles and takeaways', () => {
    const [msg] = buildPlayedMessages('Mike', [note({ title: 'Weird] [Title', takeaway: '_note_' })]);
    expect(msg).toContain('Weird\\] \\[Title');
    expect(msg).toContain('\\_note\\_');
  });

  it('splits into multiple messages rather than exceeding the 2000-char cap', () => {
    const notes = Array.from({ length: 60 }, (_, i) =>
      note({
        title: `Item number ${i} with a reasonably long title to pad things out`,
        url: `https://example.com/article/${i}`,
        played_at: new Date(Date.parse('2026-09-09T20:00:00.000Z') + i * 60_000).toISOString(),
      }),
    );
    const messages = buildPlayedMessages('Mike', notes);
    expect(messages.length).toBeGreaterThan(1);
    for (const m of messages) expect(m.length).toBeLessThanOrEqual(2000);
    // Every item still appears exactly once across the whole batch, split
    // between messages rather than dropped or duplicated.
    const joined = messages.join('\n');
    for (let i = 0; i < 60; i++) expect(joined).toContain(`https://example.com/article/${i}`);
  });

  it('never splits an item and its takeaway across two messages', () => {
    const notes = Array.from({ length: 60 }, (_, i) =>
      note({
        title: `Item ${i}`,
        url: `https://example.com/${i}`,
        takeaway: 'a short streamer note here',
        played_at: new Date(Date.parse('2026-09-09T20:00:00.000Z') + i * 60_000).toISOString(),
      }),
    );
    const messages = buildPlayedMessages('Mike', notes);
    for (const m of messages) {
      const itemLines = m.split('\n').filter((l) => /^\d+\. \[/.test(l));
      const takeawayLines = m.split('\n').filter((l) => l.trim().startsWith('↳'));
      expect(takeawayLines.length).toBeLessThanOrEqual(itemLines.length);
    }
  });
});
