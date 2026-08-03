import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { STATUS_RESET_AFTER_MS } from '@/lib/mod-status';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Daily housekeeping, triggered by Vercel Cron (see vercel.json):
//  - processed_events is a short-lived EventSub idempotency cache; nothing
//    ever reads a row older than the ~10-minute replay window, so anything
//    past a day is pure bloat.
//  - Rejected submissions are dead ends nobody revisits; old ones just add
//    noise to per-stream storage. Approved/played/pending are untouched —
//    played history and its show_notes stay intact.
//  - Mod statuses older than STATUS_RESET_AFTER_MS reset to no status —
//    this is the backstop for streams nobody's actively viewing (GET
//    /api/mod-status does the same reset on every fetch, so an active
//    viewer never waits on this once-a-day pass).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const now = Date.now();

  const eventsCutoff = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
  const { error: eventsErr, count: eventsDeleted } = await sb
    .from('processed_events')
    .delete({ count: 'exact' })
    .lt('created_at', eventsCutoff);

  const rejectedCutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error: rejectedErr, count: rejectedDeleted } = await sb
    .from('submissions')
    .delete({ count: 'exact' })
    .eq('status', 'rejected')
    .lt('created_at', rejectedCutoff);

  const modStatusCutoff = new Date(now - STATUS_RESET_AFTER_MS).toISOString();
  const { error: modStatusErr, count: modStatusesReset } = await sb
    .from('moderators')
    .update(
      { status: null, status_note: null, status_updated_at: new Date(now).toISOString(), status_via_mobile: false },
      { count: 'exact' },
    )
    .not('status', 'is', null)
    .lt('status_updated_at', modStatusCutoff);

  if (eventsErr) console.error('cleanup: processed_events failed:', eventsErr.message);
  if (rejectedErr) console.error('cleanup: rejected submissions failed:', rejectedErr.message);
  if (modStatusErr) console.error('cleanup: mod status reset failed:', modStatusErr.message);

  return NextResponse.json({
    ok: !eventsErr && !rejectedErr && !modStatusErr,
    processedEventsDeleted: eventsDeleted ?? 0,
    rejectedSubmissionsDeleted: rejectedDeleted ?? 0,
    modStatusesReset: modStatusesReset ?? 0,
  });
}
