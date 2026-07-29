// The chat message is the one place a trigger warning leaves the app and
// reaches an audience, so the budget arithmetic around it is worth pinning
// down: Twitch hard-caps messages at 500 characters, and anything over that
// is rejected outright rather than truncated for us.

import { describe, expect, it } from 'vitest';
import { buildWatchingMessage } from './announce';

const URL_A = 'https://www.reuters.com/world/us/senate-passes-budget-bill';
const MAX = 500;

describe('buildWatchingMessage', () => {
  it('leaves the message untouched when there is no trigger warning', () => {
    expect(buildWatchingMessage('Senate passes budget bill', URL_A)).toBe(
      `Watching: Senate passes budget bill ${URL_A}`,
    );
  });

  it('treats empty and whitespace-only warnings as absent', () => {
    const plain = buildWatchingMessage('Title', URL_A);
    expect(buildWatchingMessage('Title', URL_A, '')).toBe(plain);
    expect(buildWatchingMessage('Title', URL_A, '   ')).toBe(plain);
    expect(buildWatchingMessage('Title', URL_A, null)).toBe(plain);
  });

  it('appends the warning after the url', () => {
    expect(buildWatchingMessage('Title', URL_A, 'graphic footage of the crash')).toBe(
      `Watching: Title ${URL_A} ⚠ TW: graphic footage of the crash`,
    );
  });

  it('trims surrounding whitespace off the warning', () => {
    expect(buildWatchingMessage('Title', URL_A, '  discussion of suicide \n')).toBe(
      `Watching: Title ${URL_A} ⚠ TW: discussion of suicide`,
    );
  });

  it('strips playlist params from the url before the warning is appended', () => {
    const msg = buildWatchingMessage('Title', 'https://youtube.com/watch?v=abc&list=SECRET', 'gore');
    expect(msg).not.toContain('SECRET');
    expect(msg.endsWith('⚠ TW: gore')).toBe(true);
  });

  it('truncates the title, not the warning, to stay under the limit', () => {
    const warning = 'graphic footage of the crash and its aftermath';
    const msg = buildWatchingMessage('T'.repeat(600), URL_A, warning);
    expect(msg.length).toBeLessThanOrEqual(MAX);
    expect(msg).toContain(URL_A);
    expect(msg.endsWith(`⚠ TW: ${warning}`)).toBe(true);
  });

  it('caps an over-long warning rather than letting it crowd out the title', () => {
    const msg = buildWatchingMessage('Senate passes budget bill', URL_A, 'W'.repeat(400));
    expect(msg.length).toBeLessThanOrEqual(MAX);
    expect(msg).toContain('Senate passes budget bill');
    expect(msg).toContain('⚠ TW: ');
    expect(msg.endsWith('…')).toBe(true);
  });

  it('drops the title entirely when the url and warning leave no room for it', () => {
    const longUrl = `https://example.com/${'p'.repeat(300)}`;
    const msg = buildWatchingMessage('A headline that will not fit', longUrl, 'W'.repeat(200));
    expect(msg.length).toBeLessThanOrEqual(MAX);
    expect(msg.startsWith(`Watching: ${longUrl}`)).toBe(true);
    expect(msg).not.toContain('…  '); // no collapsed-title double space
  });
});
