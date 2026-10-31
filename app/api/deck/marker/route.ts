import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { getValidAccessToken } from '@/lib/announce';
import { createStreamMarker } from '@/lib/twitch-oauth';
import { buildMarkerDescription } from '@/lib/marker';
import { resolveTitle } from '@/lib/title-override';

// Drops a Twitch stream marker titled after an item, when the streamer has
// "marker on Open source" turned on (Settings → Deck). Streamer-only: the
// marker lands on their live broadcast, so a curate mod browsing sources while
// prepping must not be able to leave marks on it.
export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (session.role !== 'streamer') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const subId = body.id ? String(body.id) : '';
  if (!subId) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: channel } = await sb
    .from('streams')
    .select('twitch_user_id, marker_on_open')
    .eq('id', session.streamId)
    .maybeSingle();
  if (!channel) return NextResponse.json({ error: 'stream not found' }, { status: 404 });
  // Checked here too, not just in the UI, so a stale tab can't keep marking
  // after the setting was turned off.
  if (channel.marker_on_open !== true) return NextResponse.json({ ok: true, skipped: 'disabled' });
  if (!channel.twitch_user_id) return NextResponse.json({ error: 'no-twitch' }, { status: 409 });

  const { data: sub } = await sb
    .from('submissions')
    .select('title, title_override, url')
    .eq('id', subId)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: 'submission not found' }, { status: 404 });

  const reconnect = () =>
    NextResponse.json(
      { error: 'reconnect', detail: 'Stream markers need reauthorization — sign out and back in.' },
      { status: 400 },
    );
  const token = await getValidAccessToken(session.streamId);
  if (!token) return reconnect();

  const result = await createStreamMarker(
    token,
    channel.twitch_user_id,
    buildMarkerDescription(resolveTitle(sub), sub.url),
  );
  if (result.ok) return NextResponse.json({ ok: true });
  if (result.reason === 'reconnect') return reconnect();
  if (result.reason === 'offline') {
    return NextResponse.json({ ok: false, error: 'offline', detail: 'Not live (or VODs are off), so no marker was added.' });
  }
  return NextResponse.json({ error: 'marker failed', detail: result.error }, { status: 502 });
}
