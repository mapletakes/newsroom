import { describe, expect, it } from 'vitest';
import { stripHtml } from './extract-twitter';

describe('stripHtml', () => {
  it('turns <br> into newlines, drops tags and decodes entities', () => {
    expect(stripHtml('Q&amp;A tonight<br>it&#8217;s <a href="https://t.co/x">live</a> &mdash; 9pm'))
      .toBe('Q&A tonight\nit’s live — 9pm');
  });

  it('keeps escaped angle brackets as text instead of stripping them as tags', () => {
    expect(stripHtml('use &lt;b&gt; for bold')).toBe('use <b> for bold');
  });
});
