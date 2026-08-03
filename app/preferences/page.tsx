import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { sanitizeAppTheme } from '@/lib/theme';
import { StreamTheme } from '@/components/StreamTheme';
import { AppHeader } from '@/components/AppHeader';
import { AppThemeSettings } from '@/app/setup/ThemeSettings';

export const dynamic = 'force-dynamic';

/**
 * A person's own appearance, as opposed to /setup's channel-wide settings.
 *
 * Exists because a mod had nowhere to configure anything: /setup is the
 * streamer's channel (commands, brand, add token) and is now closed to them,
 * while the header's preset picker only ever lived in localStorage — so a
 * mod's choice reset on every new browser and could never be a custom palette.
 * What's saved here is keyed to their Twitch account, so it follows them to
 * every channel they moderate and every device they sign in from.
 */
export default async function PreferencesPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  // Streamers already have this, and more: /setup's Appearance tab sets the
  // channel brand, which is what they see. Sending them there rather than
  // offering a second, near-identical palette editor whose relationship to
  // the first would need explaining.
  if (session.role === 'streamer') redirect('/setup#appearance');

  const sb = supabaseAdmin();
  const { data: prefs } = await sb
    .from('user_prefs')
    .select('app_theme')
    .eq('twitch_user_id', session.twitchUserId)
    .maybeSingle();

  return (
    <>
      <StreamTheme />
      <div className="min-h-screen flex flex-col">
        <AppHeader
          className="border-b-2 border-ink px-6 py-3 gap-6"
          section={<>preferences · {session.displayName}</>}
          right={
            <>
              <Link href="/mod" className="underline hover:text-rust">Mod View →</Link>
              <Link href="/choose" className="underline hover:text-rust">Switch Channel</Link>
            </>
          }
        />
        <main className="flex-1 px-6 py-8 max-w-3xl mx-auto w-full">
          <h1 className="font-display text-3xl font-bold mb-1">Appearance</h1>
          <p className="font-mono text-[11px] uppercase tracking-widest text-ink/50 mb-6">
            Yours alone · applies on every channel you mod
          </p>

          <AppThemeSettings
            initial={sanitizeAppTheme(prefs?.app_theme)}
            endpoint="/api/prefs"
            intro={
              <>
                How the deck, mod view, and shelf look <strong>for you</strong>. Nobody else is
                affected — not the streamer, not the other mods, and never anyone watching. Once
                saved, pick <strong>My theme</strong> from the theme menu in the top right to turn
                it on.
              </>
            }
            saveNote="The page reloads on save — the palette is applied server-side, so that's what makes it show up."
          />
        </main>
      </div>
    </>
  );
}
