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

/** Below Tailwind's `lg` — the width at which the deck's two-pane layout stops
 *  fitting and the touch layout takes over. */
export const MOBILE_QUERY = '(max-width: 1023px)';
