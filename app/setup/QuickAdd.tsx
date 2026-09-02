'use client';

// Quick add (bookmarklet + browser-extension token) widget. Fully
// self-contained except for `token`/`setToken`, which live in SetupForm
// because the same add token also builds the overlay URL on a different tab
// — regenerating it on one tab would otherwise leave the other showing a
// dead URL until a reload. Split out of SetupForm.tsx as a structural move
// only, no rendered output changed.

import { useEffect, useRef, useState } from 'react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function QuickAdd({
  token,
  setToken,
}: {
  token: string | null;
  setToken: (t: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const bookmarklet = token
    ? `javascript:(function(){window.open('${origin}/quick-add?token=${token}&url='+encodeURIComponent(location.href),'nr_add','width=440,height=280');})();`
    : '';

  // React blocks javascript: hrefs, so set it on the DOM node directly.
  useEffect(() => {
    if (linkRef.current && bookmarklet) linkRef.current.setAttribute('href', bookmarklet);
  }, [bookmarklet]);

  const { confirm, confirmDialog } = useConfirm();

  const generate = async () => {
    if (token && !(await confirm({
      title: 'Regenerate add token?',
      description: 'Your existing bookmarklet, extension, and OBS overlay URL will stop working until you replace the token.',
      confirmText: 'Regenerate',
      destructive: true,
    }))) return;
    setBusy(true);
    try {
      const r = await fetch('/api/deck/token', { method: 'POST' });
      if (r.ok) {
        const d = await r.json();
        setToken(d.token);
      }
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const copyToken = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div>
      {confirmDialog}
      <p className="text-sm text-ink/70 leading-relaxed mb-4 max-w-prose">
        Add the page you&apos;re on straight to your deck while prepping — no copy/paste or
        tab-switching. Works on articles, tweets, and YouTube videos (paste a playlist URL to
        bulk-add). Items land as <strong>approved</strong>, ready in the deck.
      </p>

      {!token ? (
        <Button onClick={generate} disabled={busy}>
          {busy ? 'Generating…' : 'Generate add link'}
        </Button>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
              Drag this to your bookmarks bar:
            </p>
            {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
            <a
              ref={linkRef}
              onClick={(e) => e.preventDefault()}
              draggable
              className="inline-block cursor-grab active:cursor-grabbing font-mono text-sm uppercase tracking-widest bg-moss text-paper px-4 py-2 select-none"
              title="Drag me to your bookmarks bar"
            >
              + Add to The Broadside
            </a>
            <p className="text-xs text-ink/50 mt-2">
              Then on any page, click the bookmark — a small window confirms and closes.
              Can&apos;t drag it? <button onClick={copy} className="underline hover:text-rust">{copied ? 'Copied!' : 'Copy the code'}</button> and create a new bookmark with it as the URL.
            </p>
          </div>

          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
              Token (for the browser extension)
            </p>
            <div className="flex gap-1 items-center">
              <Input
                readOnly
                value={token ?? ''}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 text-xs bg-ink/10 border-ink/20"
                aria-label="Add token"
              />
              <Button type="button" size="sm" className="shrink-0" onClick={copyToken}>
                {tokenCopied ? 'Copied!' : 'Copy'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={generate}
                disabled={busy}
              >
                {busy ? '…' : 'Regenerate'}
              </Button>
            </div>
            <p className="text-xs text-ink/50 mt-2">
              Get the extension from the{' '}
              <a
                href="https://chromewebstore.google.com/search/The%20Broadside%20Quick%20Add"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-rust"
              >
                Chrome Web Store
              </a>{' '}
              (&ldquo;The Broadside Quick Add&rdquo;), then paste this token into its Options page.
            </p>
          </div>

        </div>
      )}
    </div>
  );
}
