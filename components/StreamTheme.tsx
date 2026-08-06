import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import {
  appThemeCssVars,
  appThemeIsCustomised,
  googleFontsHref,
  resolveFonts,
  sanitizeAppTheme,
} from '@/lib/theme';
import { BrandThemeDefault } from './BrandThemeDefault';

/** `appThemeCssVars`'s object as a `key:value;key:value` string, for the
 *  server-rendered <style> block below. The settings preview wants the same
 *  object shape (React accepts custom properties directly in a style prop),
 *  which is the whole reason that function returns a plain object rather
 *  than a string in the first place. */
function cssVarsToString(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
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
    const vars = appThemeCssVars(brand);
    // Split, not because the values differ from the combined object below —
    // they don't — but because of WHERE each half has to land. Palette stays
    // scoped to html.brand (only active when that theme class is), while the
    // fonts go on :root unconditionally, per this function's own doc comment
    // above: a mod who switches to High Contrast for legibility keeps the
    // stream's typefaces even though they've just opted out of its palette.
    const { '--font-display': fontDisplay, '--font-sans': fontSans, '--font-mono': fontMono, ...paletteOnly } = vars;
    families.push(...Object.values(resolveFonts(brand.fonts)));
    blocks.push(
      `html.brand{${cssVarsToString(paletteOnly)}}` +
        `:root{${cssVarsToString({ '--font-display': fontDisplay, '--font-sans': fontSans, '--font-mono': fontMono })}}`,
    );
  }

  if (personal && personalActive) {
    // No split here — a personal theme's fonts are scoped to html.mine right
    // along with its palette, the one deliberate exception the doc comment
    // above calls out.
    families.push(...Object.values(resolveFonts(personal.fonts)));
    blocks.push(`html.mine{${cssVarsToString(appThemeCssVars(personal))}}`);
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
