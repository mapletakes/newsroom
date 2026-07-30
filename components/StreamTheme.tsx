import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import {
  appThemeIsCustomised,
  fontStack,
  googleFontsHref,
  hexToTriplet,
  PALETTE_TOKENS,
  resolveAppPalette,
  resolveFonts,
  sanitizeAppTheme,
} from '@/lib/theme';
import { BrandThemeDefault } from './BrandThemeDefault';

/**
 * Applies the stream's chosen palette and typefaces to the app.
 *
 * Rendered from each authed page rather than the root layout: the layout is
 * shared with /login, /privacy and friends, and reading the session cookie
 * there would opt every one of those into dynamic rendering for the sake of a
 * theme they never show. The pages that do render it are all `force-dynamic`
 * already.
 *
 * The palette lands as `html.brand`, a real next-themes theme rather than an
 * override of the existing ones — that's what keeps "stream default, personal
 * override" honest. A mod who explicitly picks High contrast because they
 * can't read the streamer's palette keeps that choice, because their pick is
 * stored and only an *unset* preference falls through to brand.
 *
 * Typefaces are applied at `:root`, outside the palette classes, because the
 * two are independent decisions — switching to High contrast for legibility
 * shouldn't also throw away the stream's fonts. (There's deliberately no
 * per-user font override; contrast is the accessibility lever that matters
 * here, and a second one would be a second thing to explain.)
 */
export async function StreamTheme() {
  const session = await getSession();
  if (!session) return null;

  const sb = supabaseAdmin();
  const { data } = await sb
    .from('streams')
    .select('app_theme')
    .eq('id', session.streamId)
    .maybeSingle();
  if (!data?.app_theme) return null;

  const theme = sanitizeAppTheme(data.app_theme);
  // Nothing customised — leave next-themes alone so "System" still tracks the
  // viewer's OS dark mode, which is the better default when there's no brand.
  if (!appThemeIsCustomised(theme)) return null;

  const palette = resolveAppPalette(theme);
  const fonts = resolveFonts(theme.fonts);

  // Safe to inline: every value below has been through sanitizeAppTheme, which
  // normalises colours to /^#[0-9a-f]{6}$/ and restricts font families to
  // letters, digits and spaces. Nothing here can carry a brace or a semicolon
  // out of the database and into the stylesheet.
  const paletteVars = PALETTE_TOKENS.map((t) => `--${t}:${hexToTriplet(palette[t])}`).join(';');
  const css =
    `html.brand{${paletteVars}}` +
    `:root{` +
    `--font-display:${fontStack(fonts.display, 'display')};` +
    `--font-sans:${fontStack(fonts.sans, 'sans')};` +
    `--font-mono:${fontStack(fonts.mono, 'mono')}` +
    `}`;

  const href = googleFontsHref([fonts.display, fonts.sans, fonts.mono]);

  return (
    <>
      {href && <link rel="stylesheet" href={href} />}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <BrandThemeDefault />
    </>
  );
}
