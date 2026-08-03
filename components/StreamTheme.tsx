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

function paletteVars(palette: ReturnType<typeof resolveAppPalette>) {
  return PALETTE_TOKENS.map((t) => `--${t}:${hexToTriplet(palette[t])}`).join(';');
}

/**
 * Applies the stream's chosen palette and typefaces to the app, plus the
 * viewer's own personal theme if they've set one.
 *
 * Rendered from each authed page rather than the root layout: the layout is
 * shared with /login, /privacy and friends, and reading the session cookie
 * there would opt every one of those into dynamic rendering for the sake of a
 * theme they never show. The pages that do render it are all `force-dynamic`
 * already.
 *
 * Two independent layers, each landing as a real next-themes theme class
 * rather than an override of the existing ones:
 *
 *   html.brand — the stream's branding (streams.app_theme). Shared by everyone
 *                looking at that channel, and the default for anyone who has
 *                never picked a theme of their own.
 *   html.mine  — the viewer's own (user_prefs.app_theme), keyed on their
 *                twitch id and identical on every channel they work. This is
 *                what a mod gets in place of the channel settings they can't
 *                have: a look that follows them and changes nothing anyone
 *                else sees.
 *
 * Only one class is ever on <html> at a time, so the layers never blend —
 * picking "My theme" replaces the brand rather than tinting it. That's what
 * keeps "stream default, personal override" honest: an explicit pick is
 * stored, and only an *unset* preference falls through to brand.
 *
 * The stream's typefaces are applied at `:root`, outside the palette classes,
 * because palette and type are independent decisions — switching to High
 * contrast for legibility shouldn't also throw away the stream's fonts. A
 * personal theme's fonts are the exception and ARE scoped to `html.mine`
 * (element+class outranks `:root` on specificity): those are a deliberate
 * choice about one's own reading, so they should apply while that theme is
 * active and stop the moment it isn't.
 */
export async function StreamTheme() {
  const session = await getSession();
  if (!session) return null;

  const sb = supabaseAdmin();
  const [{ data: stream }, { data: prefs }] = await Promise.all([
    sb.from('streams').select('app_theme').eq('id', session.streamId).maybeSingle(),
    sb.from('user_prefs').select('app_theme').eq('twitch_user_id', session.twitchUserId).maybeSingle(),
  ]);

  const brand = stream?.app_theme ? sanitizeAppTheme(stream.app_theme) : null;
  // Nothing customised — leave next-themes alone so "System" still tracks the
  // viewer's OS dark mode, which is the better default when there's no brand.
  const brandActive = brand !== null && appThemeIsCustomised(brand);

  const personal = prefs?.app_theme ? sanitizeAppTheme(prefs.app_theme) : null;
  const personalActive = personal !== null && appThemeIsCustomised(personal);

  if (!brandActive && !personalActive) return null;

  const blocks: string[] = [];
  const families: string[] = [];

  if (brand && brandActive) {
    const palette = resolveAppPalette(brand);
    const fonts = resolveFonts(brand.fonts);
    families.push(fonts.display, fonts.sans, fonts.mono);
    blocks.push(
      `html.brand{${paletteVars(palette)}}` +
        `:root{` +
        `--font-display:${fontStack(fonts.display, 'display')};` +
        `--font-sans:${fontStack(fonts.sans, 'sans')};` +
        `--font-mono:${fontStack(fonts.mono, 'mono')}` +
        `}`,
    );
  }

  if (personal && personalActive) {
    const palette = resolveAppPalette(personal);
    const fonts = resolveFonts(personal.fonts);
    families.push(fonts.display, fonts.sans, fonts.mono);
    blocks.push(
      `html.mine{${paletteVars(palette)};` +
        `--font-display:${fontStack(fonts.display, 'display')};` +
        `--font-sans:${fontStack(fonts.sans, 'sans')};` +
        `--font-mono:${fontStack(fonts.mono, 'mono')}` +
        `}`,
    );
  }

  const href = googleFontsHref(families);

  return (
    <>
      {href && <link rel="stylesheet" href={href} />}
      {/* Safe to inline: every value above has been through sanitizeAppTheme,
          which normalises colours to /^#[0-9a-f]{6}$/ and restricts font
          families to letters, digits and spaces. Nothing here can carry a
          brace or a semicolon out of the database and into the stylesheet. */}
      <style dangerouslySetInnerHTML={{ __html: blocks.join('') }} />
      {brandActive && <BrandThemeDefault />}
    </>
  );
}
