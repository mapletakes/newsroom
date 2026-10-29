// extension/capture.js runs inside the reader's tab; here it runs against a
// jsdom page standing in for a signed-in news article.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// jsdom ships without type definitions; this test only needs its constructor.
const { JSDOM } = require('jsdom') as {
  JSDOM: new (html: string, options: { url: string; runScripts: string }) => {
    window: Window & typeof globalThis;
    serialize(): string;
  };
};
const { broadsideCapture } = require('./capture.js') as {
  broadsideCapture: (doc: Document, terms: string[]) => { url: string; title: string; html: string };
};

function signedInPage() {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head>
      <title>Story</title>
      <meta name="user-id" content="u-123">
      <script>window.__session = { email: "mike@example.com" };</script>
      <script type="application/ld+json">{"@type":"NewsArticle","headline":"Story"}</script>
      <style id="cssinjs"></style>
    </head><body data-user-id="u-123">
      <header>
        <div class="account-menu">Hi Mike Brown</div>
        <span>Signed in as mike@example.com</span>
      </header>
      <noscript><p>Enable JavaScript</p></noscript>
      <article>
        <h1>Story</h1>
        <p>Email the reporter at reporter@news.example with tips.</p>
        <p class="account-of-events">An account of events, mentioning Mike Brown by name.</p>
      </article>
    </body></html>`,
    { url: 'https://news.example/story', runScripts: 'outside-only' },
  );
  const sheet = (dom.window.document.getElementById('cssinjs') as HTMLStyleElement).sheet!;
  sheet.insertRule('.injected { color: red; }', 0);
  return dom;
}

describe('broadsideCapture', () => {
  it('drops scripts and noscript fallbacks, keeping JSON-LD article metadata', () => {
    const { html } = broadsideCapture(signedInPage().window.document, []);
    expect(html).not.toContain('__session');
    expect(html).toContain('application/ld+json');
    expect(html).not.toContain('Enable JavaScript');
  });

  it('keeps rules scripts inserted into an empty <style>', () => {
    const { html } = broadsideCapture(signedInPage().window.document, []);
    expect(html).toContain('.injected');
  });

  it('removes account UI and emails outside the article, but not the article itself', () => {
    const { html } = broadsideCapture(signedInPage().window.document, []);
    expect(html).not.toContain('Hi Mike Brown');
    expect(html).not.toContain('mike@example.com');
    expect(html).toContain('[email removed]');
    expect(html).toContain('reporter@news.example');
    expect(html).toContain('An account of events');
  });

  it('removes the reader’s own words, and attributes naming users', () => {
    const { html } = broadsideCapture(signedInPage().window.document, ['Mike Brown']);
    expect(html).not.toContain('Mike Brown');
    expect(html).toContain('mentioning [removed] by name');
    expect(html).not.toContain('u-123');
  });

  it('leaves the live page untouched', () => {
    const dom = signedInPage();
    const before = dom.serialize();
    broadsideCapture(dom.window.document, ['Mike Brown']);
    expect(dom.serialize()).toBe(before);
  });

  it('reports the page URL and title', () => {
    const r = broadsideCapture(signedInPage().window.document, []);
    expect(r.url).toBe('https://news.example/story');
    expect(r.title).toBe('Story');
  });
});
