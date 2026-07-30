import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sanitizeAppTheme, sanitizeOverlayTheme } from '@/lib/theme';

export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.submit_command === 'string') {
    patch.submit_command = body.submit_command.trim() || null;
  }
  if (typeof body.video_command === 'string') {
    patch.video_command = body.video_command.trim() || null;
  }
  if (typeof body.allow_anyone === 'boolean') patch.allow_anyone = body.allow_anyone;
  if (typeof body.allow_duplicates === 'boolean') patch.allow_duplicates = body.allow_duplicates;
  if (typeof body.auto_summarize === 'boolean') patch.auto_summarize = body.auto_summarize;
  if (Array.isArray(body.ignored_users)) {
    patch.ignored_users = body.ignored_users
      .map((u: string) => String(u).trim().toLowerCase())
      .filter(Boolean);
  }
  if (Array.isArray(body.preferred_sources)) {
    patch.preferred_sources = body.preferred_sources
      .map((s: string) => String(s).trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, ''))
      .filter(Boolean);
  }
  // Normalised on the way in, not on the way out: these are read by the
  // overlay on every poll and by every app page render, and a font family
  // here ends up inside both a stylesheet URL and a CSS font-family value.
  // Validating once at the write keeps every reader from having to.
  if ('app_theme' in body) patch.app_theme = sanitizeAppTheme(body.app_theme);
  if ('overlay_theme' in body) patch.overlay_theme = sanitizeOverlayTheme(body.overlay_theme);

  const sb = supabaseAdmin();
  const { error } = await sb.from('streams').update(patch).eq('id', session.streamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
