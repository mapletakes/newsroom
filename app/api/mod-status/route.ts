import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession, getApprovedSession } from '@/lib/session';
import { sanitizeModStatus, sanitizeStatusNote, STATUS_RESET_AFTER_MS } from '@/lib/mod-status';
import { broadcastModStatusChange } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

async function modStatusEnabledFor(streamId: string): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data } = await sb.from('streams').select('mod_status_enabled').eq('id', streamId).maybeSingle();
  return data?.mod_status_enabled === true;
}

// Resets any status on this stream that's aged past STATUS_RESET_AFTER_MS —
// run before every GET so a viewer never sees stale data just because the
// daily cleanup cron (see app/api/cron/cleanup) hasn't reached it yet.
// Best-effort: a failure here shouldn't block the roster itself from
// loading, so it only logs.
async function resetStaleStatuses(streamId: string): Promise<void> {
  const sb = supabaseAdmin();
  const cutoff = new Date(Date.now() - STATUS_RESET_AFTER_MS).toISOString();
  const { error } = await sb
    .from('moderators')
    .update({
      status: null,
      status_note: null,
      status_updated_at: new Date().toISOString(),
      status_via_mobile: false,
    })
    .eq('stream_id', streamId)
    .not('status', 'is', null)
    .lt('status_updated_at', cutoff);
  if (error) console.error('mod-status: stale reset failed:', error.message);
}

// The roster: every mod on this stream with their self-reported availability.
// Open to the streamer and to any mod — the whole point is that the team can
// see each other, so there's no per-mod visibility gate beyond the
// account-level feature flag.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await modStatusEnabledFor(session.streamId))) {
    return NextResponse.json({ error: 'mod status not enabled' }, { status: 403 });
  }

  await resetStaleStatuses(session.streamId);

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('moderators')
    .select('twitch_user_id, twitch_login, status, status_note, status_updated_at, status_via_mobile')
    .eq('stream_id', session.streamId)
    .order('twitch_login', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    mods: (data ?? []).map((m) => ({
      twitchUserId: m.twitch_user_id,
      login: m.twitch_login,
      status: m.status ?? null,
      note: m.status_note ?? null,
      updatedAt: m.status_updated_at ?? null,
      viaMobile: m.status_via_mobile === true,
      // Lets the client mark one row editable without having to be told the
      // viewer's id separately (and without trusting it if it were).
      isSelf: m.twitch_user_id === session.twitchUserId,
    })),
  });
}

/**
 * Set the CALLER'S OWN availability. There is deliberately no way to set
 * anyone else's: the row is always located by the session's twitch id, never
 * by an id from the body, so no request shape exists that could mark another
 * mod available. A streamer reading the board is an observer, not an editor.
 */
export async function PATCH(req: Request) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await modStatusEnabledFor(session.streamId))) {
    return NextResponse.json({ error: 'mod status not enabled' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const status = sanitizeModStatus(body.status);
  const note = sanitizeStatusNote(body.note);
  const viaMobile = body.viaMobile === true;

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('moderators')
    .update({
      status,
      status_note: note,
      // Stamped server-side, not taken from the client: the age shown beside
      // a status is the only thing keeping it honest, so it can't be
      // something the poster gets to choose.
      status_updated_at: new Date().toISOString(),
      status_via_mobile: viaMobile,
    })
    .eq('stream_id', session.streamId)
    .eq('twitch_user_id', session.twitchUserId)
    .select('twitch_user_id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // The streamer isn't in `moderators`, so they have no row to update — the
  // roster is a mods-only board and they're an observer of it.
  if (!data) {
    return NextResponse.json({ error: 'no moderator row for this account' }, { status: 404 });
  }

  broadcastModStatusChange(session.streamId);
  return NextResponse.json({ ok: true, status, note });
}
