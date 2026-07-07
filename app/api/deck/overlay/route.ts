// Token-authed "now playing" for the OBS browser-source overlay (/overlay).
// Auth is the personal add token (?token=), same as quick-add/segments — the
// overlay URL lives in the streamer's OBS config like the bookmarklet does.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRateLimit, hashKey } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

// This endpoint is polled every few seconds from an OBS browser source with a
// bare token in the query string and no session cookie — unlike the
// cookie-authed app routes, which CDNs/edge caches virtually never cache by
// default, a plain cookie-less GET like this one is exactly the shape of
// request an edge cache is most likely to treat as a cacheable public
// resource if nothing says otherwise. Without an explicit no-store here, the
// overlay can get stuck showing the first response served for this URL
// indefinitely, regardless of how often (or how fast) it polls.
const NO_STORE = { 'Cache-Control': 'no-store, must-revalidate' };

function json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return NextResponse.json(body, { status: init?.status, headers: { ...NO_STORE, ...init?.headers } });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  if (!token) {
    return json({ ok: false, error: 'missing token' }, { status: 400 });
  }

  // Also caps the blast radius of any future client-side bug that polls this
  // endpoint too aggressively (see lib/ratelimit.ts — sized against this
  // route's own real-world traffic pattern).
  const limited = await checkRateLimit('poll', hashKey(token));
  if (!limited.ok) {
    return json(
      { ok: false, error: 'rate limited, try again shortly' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('id, now_playing_id')
    .eq('add_token', token)
    .maybeSingle();
  if (!stream) {
    return json({ ok: false, error: 'invalid token' }, { status: 401 });
  }

  // streamId is returned so the overlay can subscribe to this stream's
  // realtime "changed" pings (they carry no data, just a refetch signal).
  if (!stream.now_playing_id) {
    return json({ ok: true, streamId: stream.id, nowPlaying: null });
  }

  const { data: np } = await sb
    .from('submissions')
    .select('title, url, kind, publisher, duration_seconds')
    .eq('id', stream.now_playing_id)
    .eq('stream_id', stream.id)
    .maybeSingle();

  // No credibility/leaning tag in the payload: that's a streamer/mod triage
  // aid, not something the viewer-facing overlay should display.
  return json({
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
