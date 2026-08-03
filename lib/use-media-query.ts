'use client';

import { useEffect, useState } from 'react';

/**
 * Matches a CSS media query, reactively.
 *
 * Starts false and only becomes true after mount, deliberately: this decides
 * which of two whole layouts to MOUNT, not just which to show, and the server
 * has no viewport to measure. Rendering the desktop tree first and swapping
 * keeps the server and the first client render in agreement rather than
 * trading a hydration mismatch for one frame of layout.
 *
 * Mounting one tree rather than CSS-hiding the other matters here: the deck's
 * desktop panel owns a YouTube iframe and a dnd-kit context, and rendering
 * both would load the video twice and register every queue item as two
 * draggables.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const sync = () => setMatches(mql.matches);
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, [query]);

  return matches;
}

/**
 * When to mount the touch deck instead of the desktop one.
 *
 * Width alone was the wrong question. At `(max-width: 1023px)` — Tailwind's
 * `lg` — an ordinary split-screen window trips it: half of a 1440p display is
 * ~720px, half of 1080p is ~960px. A curator working beside another window
 * would get bumped to the touch layout, losing drag-to-reorder and the
 * keyboard shortcuts, on a machine plainly driving a mouse.
 *
 * `pointer: coarse` reports the PRIMARY input, so it separates the two cases
 * width can't: a narrowed desktop window stays `fine` and keeps the full
 * deck, while a phone or tablet stays `coarse` and still gets the touch one.
 * Width is kept alongside it — a coarse-pointer tablet with room for two
 * panes has no reason to be handed the narrow layout.
 *
 * The `max-width: 639px` clause is a floor under that, and applies whatever
 * the pointer is. Pointer alone would let someone drag a mouse-driven window
 * down to phone width and keep a layout built for two panes; below Tailwind's
 * `sm` the touch deck is the better answer no matter what's driving it.
 */
export const MOBILE_QUERY = '(max-width: 639px), (max-width: 1023px) and (pointer: coarse)';
