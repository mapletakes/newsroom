'use client';

import { useEffect } from 'react';
import { googleFontsHref } from './theme';

/**
 * Load a set of Google font families at runtime.
 *
 * Runtime rather than build time because the families are a streamer's choice,
 * read from the database — there's no compile step that could know them. The
 * app's three defaults still come from the static @import in globals.css, so
 * this only ever fires for a stream that has actually picked something else.
 *
 * Deliberately never removes the <link> it added. A stylesheet that's been
 * applied is cheap to leave in place and expensive to take away: removing it
 * restyles every element still using the family mid-render, and re-adding it
 * on the next theme poll would flash the text back. At most this accumulates
 * one link per distinct theme the page has seen, which for an OBS source is
 * one.
 */
export function useGoogleFonts(families: string[]) {
  const href = googleFontsHref(families);
  useEffect(() => {
    if (!href || typeof document === 'undefined') return;
    if (document.querySelector(`link[data-gfont="${CSS.escape(href)}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.gfont = href;
    document.head.appendChild(link);
  }, [href]);
}
