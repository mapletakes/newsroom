// Token-authed "now playing" for the OBS browser-source overlay (/overlay).
// Auth is the personal add token (?token=), same as quick-add/segments — the
// overlay URL lives in the streamer's OBS config like the bookmarklet does.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  if (!token) {
    return NextResponse.json({ ok: false, error: 'missing token' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('id, now_playing_id')
    .eq('add_token', token)
    .maybeSingle();
  if (!stream) {
    return NextResponse.json({ ok: false, error: 'invalid token' }, { status: 401 });
  }

  // streamId is returned so the overlay can subscribe to this stream's
  // realtime "changed" pings (they carry no data, just a refetch signal).
  if (!stream.now_playing_id) {
    return NextResponse.json({ ok: true, streamId: stream.id, nowPlaying: null });
  }

  const { data: np } = await sb
    .from('submissions')
    .select('title, url, kind, publisher, duration_seconds')
    .eq('id', stream.now_playing_id)
    .eq('stream_id', stream.id)
    .maybeSingle();

  // No credibility/leaning tag in the payload: that's a streamer/mod triage
  // aid, not something the viewer-facing overlay should display.
  return NextResponse.json({
    ok: true,
    streamId: stream.id,
    nowPlaying: np
      ? {
          title: np.title || np.url,
          kind: np.kind,
          publisher: np.publisher,
          durationSeconds: np.duration_seconds,
        }
      : null,
  });
}
