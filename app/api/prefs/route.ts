import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sanitizeAppTheme } from '@/lib/theme';

export const dynamic = 'force-dynamic';

// A person's own appearance, as opposed to /api/setup's channel-wide brand.
//
// Open to any approved session, mod or streamer, with no role check — and
// that's safe for the reason /api/setup isn't: the row is always located by
// the session's own twitch id, never by one from the body, so there is no
// request shape that writes anyone else's preferences. The blast radius of
// this endpoint is "what I see", by construction.
export async function GET() {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('user_prefs')
    .select('app_theme')
    .eq('twitch_user_id', session.twitchUserId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ appTheme: data?.app_theme ?? null });
}

export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!('app_theme' in body)) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  // Through the same sanitizer the stream brand uses: this ends up inlined
  // into a <style> tag by PersonalTheme, so colours are normalised to
  // #rrggbb and font names to letters/digits/spaces before they can carry a
  // brace or semicolon out of the database and into the stylesheet.
  const appTheme = sanitizeAppTheme(body.app_theme);

  const sb = supabaseAdmin();
  const { error } = await sb.from('user_prefs').upsert(
    {
      twitch_user_id: session.twitchUserId,
      app_theme: appTheme,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'twitch_user_id' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, appTheme });
}
