'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';

// next-themes' default storage key. Read directly rather than via the hook
// because the hook can't distinguish "the user chose System" from "the user
// has never chosen anything" — both surface as theme === 'system', and only
// the second one should fall through to the stream's brand.
const STORAGE_KEY = 'theme';

/**
 * Makes the stream's brand palette the default for anyone who hasn't picked a
 * theme of their own. Only rendered when the stream has actually customised
 * something (see StreamTheme), so a mod's OS dark-mode preference still wins
 * on streams with no branding.
 *
 * Writing the choice through setTheme (rather than just slapping the class on)
 * keeps next-themes as the single owner of the html class — otherwise its next
 * render would clobber it straight back.
 */
export function BrandThemeDefault() {
  const { setTheme } = useTheme();

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return; // storage blocked — leave whatever next-themes resolved
    }
    if (stored) return; // an explicit choice, including "system": respect it
    setTheme('brand');
  }, [setTheme]);

  return null;
}
