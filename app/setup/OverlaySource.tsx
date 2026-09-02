'use client';

// The OBS browser-source widget: the overlay's URL, layout, and mark. Lives
// on the Overlay tab next to the colours, rather than under Quick add where
// it started — it only ended up there because it happens to be built from
// the same add token, which is an implementation detail. Fully
// self-contained except for the `token` it's built from. Split out of
// SetupForm.tsx as a structural move only, no rendered output changed.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export function OverlaySource({ token }: { token: string | null }) {
  const [copied, setCopied] = useState(false);
  const [brand, setBrand] = useState(true);
  const [variant, setVariant] = useState('default');

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = token
    // No &theme=: colours live on the stream row so they can change without
    // re-pasting this into OBS. Only the two things a source genuinely can't
    // be told later — layout and the mark — stay in the URL.
    ? `${origin}/overlay?token=${token}${brand ? '' : '&brand=0'}${variant === 'default' ? '' : `&variant=${variant}`}`
    : '';

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <section>
      <h2 className="font-display text-2xl font-bold mb-1">Overlay</h2>
      <p className="text-sm text-ink/70 mb-6 max-w-prose leading-relaxed">
        The on-air lower third: what&apos;s playing, and any trigger warning on it. Add it to OBS
        once — after that, everything below updates a live source on its own.
      </p>

      {!token ? (
        <p className="font-mono text-xs text-ink/60">
          Generate an add token under <strong>Quick add</strong> first — the overlay URL is built
          from it.
        </p>
      ) : (
        <>
          <h3 className="font-display text-xl font-bold mb-2">Browser source</h3>
          <ToggleGroup
            type="single"
            value={variant}
            onValueChange={(v) => { if (v) setVariant(v); }}
            className="mb-2 text-[10px]"
            aria-label="Overlay layout"
          >
            {([
              ['default', 'Full'],
              ['minimal', 'Minimal'],
              ['ticker', 'Up next'],
            ] as const).map(([value, label]) => (
              <ToggleGroupItem key={value} value={value}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <label className="flex items-center gap-2 mb-2 cursor-pointer">
            <input type="checkbox" checked={brand} onChange={(e) => setBrand(e.target.checked)} />
            <span className="font-mono text-xs">Show &ldquo;The Broadside&rdquo; mark on the card</span>
          </label>
          <div className="flex gap-1 items-center">
            <Input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 text-xs bg-ink/10 border-ink/20"
              aria-label="Overlay URL"
            />
            <Button type="button" size="sm" className="shrink-0" onClick={copy}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-ink/50 mt-2">
            Add as a <strong>Browser Source</strong> in OBS, about 800×100 (800×120 for Up next).
            <strong> Full</strong> shows a lower third — headline, outlet, and type.
            <strong> Minimal</strong> is a single-line title-only chip. <strong>Up next</strong>
            {' '}adds a strip showing what&apos;s queued after it. All disappear between items.
            Layout and the mark are baked into this URL, since an OBS source has no UI to change
            them later — so changing either means re-copying it. Colours and type don&apos;t: those
            reach a live source on their own.
          </p>
        </>
      )}
    </section>
  );
}
