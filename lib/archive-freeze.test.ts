import { describe, expect, it } from 'vitest';
import { bestFromSrcset, freezeHtml, freezePage, type FetchBytes } from './archive-freeze';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

// A fake network: url → [content-type, body]. Anything else 404s, so a test
// fails loudly if the freezer fetches something it shouldn't.
function fakeFetch(routes: Record<string, [string, string | Buffer]>): FetchBytes & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const hit = routes[url];
    if (!hit) return { url, status: 404, contentType: 'text/plain', bytes: Buffer.alloc(0), truncated: false };
    const [contentType, body] = hit;
    return { url, status: 200, contentType, bytes: Buffer.isBuffer(body) ? body : Buffer.from(body), truncated: false };
  }) as FetchBytes & { calls: string[] };
  fn.calls = calls;
  return fn;
}

const PAGE = 'https://news.example.com/2026/story';
const at = new Date('2026-10-29T12:00:00Z');

describe('freezeHtml — stripping', () => {
  it('removes scripts, frames, forms controls and event handlers', async () => {
    const html = `<html><head><script>alert(1)</script></head><body>
      <p onclick="steal()">Hello</p>
      <iframe src="https://evil.example/"></iframe>
      <form action="https://evil.example/login"><input name="pw"><button>Go</button><span>kept</span></form>
      <a href="javascript:alert(1)">bad link</a>
      <svg><script>alert(2)</script><a xlink:href="javascript:alert(3)">x</a></svg>
      <object data="x.swf"></object><embed src="y">
    </body></html>`;
    const { html: out } = await freezeHtml(html, PAGE, { fetchBytes: fakeFetch({}), capturedAt: at });
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/<iframe|<object|<embed|<form|<input|<button/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('Hello');
    expect(out).toContain('kept');
    expect(out).toContain('bad link');
  });

  it('removes meta refresh and replaces the charset with utf-8, adding noindex', async () => {
    const html = `<html><head><meta charset="iso-8859-1"><meta http-equiv="refresh" content="0;url=https://evil.example/"></head><body>x</body></html>`;
    const { html: out } = await freezeHtml(html, PAGE, { fetchBytes: fakeFetch({}), capturedAt: at });
    expect(out).not.toMatch(/http-equiv/i);
    expect(out).toContain('<meta charset="utf-8">');
    expect(out).toContain('noindex');
  });

  it('unwraps <noscript> and drops the lazy duplicate before it', async () => {
    const html = `<body><img class="lazy" data-src="/a.png" src="data:image/gif;base64,R0lGOD"><noscript><img src="/a.png" alt="real"></noscript></body>`;
    const fetchBytes = fakeFetch({ 'https://news.example.com/a.png': ['image/png', PNG] });
    const { html: out } = await freezeHtml(html, PAGE, { fetchBytes, capturedAt: at });
    expect(out.match(/<img/g)).toHaveLength(1);
    expect(out).toContain('alt="real"');
    expect(out).toContain('data:image/png;base64,');
  });

  it('makes links absolute and adds a banner naming the source', async () => {
    const { html: out } = await freezeHtml('<body><a href="/other">o</a></body>', PAGE, {
      fetchBytes: fakeFetch({}),
      capturedAt: at,
    });
    expect(out).toContain('href="https://news.example.com/other"');
    expect(out).toContain('data-broadside-archive');
    expect(out).toContain('news.example.com');
    expect(out).toContain('2026-10-29 12:00 UTC');
  });
});

describe('freezeHtml — inlining', () => {
  it('inlines stylesheets, @imports and their url() assets relative to each sheet', async () => {
    const fetchBytes = fakeFetch({
      'https://cdn.example.com/css/main.css': ['text/css', '@import "parts/a.css"; body { background: url(../img/bg.png) }'],
      'https://cdn.example.com/css/parts/a.css': ['text/css', '.a { background-image: url("icon.png") }'],
      'https://cdn.example.com/img/bg.png': ['image/png', PNG],
      'https://cdn.example.com/css/parts/icon.png': ['image/png', PNG],
    });
    const html = `<head><link rel="stylesheet" href="https://cdn.example.com/css/main.css"></head><body></body>`;
    const { html: out, assetsInlined } = await freezeHtml(html, PAGE, { fetchBytes, capturedAt: at });
    expect(out).not.toMatch(/<link/i);
    expect(out).toContain('.a {');
    expect(out).not.toContain('cdn.example.com/img');
    expect(assetsInlined).toBe(2);
  });

  it('picks a lazy src or the best srcset candidate', async () => {
    const fetchBytes = fakeFetch({ 'https://news.example.com/m.jpg': ['image/jpeg', PNG] });
    const html = `<body><img srcset="/s.jpg 300w, /m.jpg 1000w, /l.jpg 2400w" src="/s.jpg"></body>`;
    const { html: out } = await freezeHtml(html, PAGE, { fetchBytes, capturedAt: at });
    expect(fetchBytes.calls).toEqual(['https://news.example.com/m.jpg']);
    expect(out).toContain('data:image/jpeg;base64,');
    expect(out).not.toContain('srcset');
  });

  it('refuses to inline a non-image response behind an image URL', async () => {
    const fetchBytes = fakeFetch({ 'https://news.example.com/x.png': ['text/html', '<script>alert(1)</script>'] });
    const { html: out } = await freezeHtml('<body><img src="/x.png"></body>', PAGE, { fetchBytes, capturedAt: at });
    expect(out).not.toContain('data:text/html');
    expect(out).not.toContain('src=');
  });

  it('drops images that would push the page past its byte budget', async () => {
    const big = Buffer.alloc(200 * 1024, 1);
    const fetchBytes = fakeFetch({
      'https://news.example.com/1.png': ['image/png', big],
      'https://news.example.com/2.png': ['image/png', big],
    });
    const { assetsInlined, assetsDropped, bytes } = await freezeHtml(
      '<body><img src="/1.png"><img src="/2.png"></body>',
      PAGE,
      { fetchBytes, capturedAt: at, maxBytes: 350 * 1024 },
    );
    expect(assetsInlined).toBe(1);
    expect(assetsDropped).toBe(1);
    expect(bytes).toBeLessThan(350 * 1024);
  });
});

describe('freezePage', () => {
  it('decodes the page using the declared charset', async () => {
    const latin1 = Buffer.from('<html><head><title>Caf\xe9</title></head><body>na\xefve</body></html>', 'latin1');
    const fetchBytes = fakeFetch({ [PAGE]: ['text/html; charset=iso-8859-1', latin1] });
    const { html, title } = await freezePage(PAGE, { fetchBytes, capturedAt: at });
    expect(title).toBe('Café');
    expect(html).toContain('naïve');
  });

  it('throws on an error status or non-HTML response', async () => {
    await expect(freezePage(PAGE, { fetchBytes: fakeFetch({}) })).rejects.toThrow(/404/);
    const pdf = fakeFetch({ [PAGE]: ['application/pdf', '%PDF'] });
    await expect(freezePage(PAGE, { fetchBytes: pdf })).rejects.toThrow(/not an HTML/);
  });
});

describe('bestFromSrcset', () => {
  it('prefers the widest candidate under the cap, else the smallest', () => {
    expect(bestFromSrcset('a.jpg 400w, b.jpg 1100w, c.jpg 2000w')).toBe('b.jpg');
    expect(bestFromSrcset('c.jpg 2000w, d.jpg 3000w')).toBe('c.jpg');
    expect(bestFromSrcset('a.jpg 1x, b.jpg 2x')).toBe('b.jpg');
  });
});
