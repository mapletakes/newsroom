import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Daily housekeeping, triggered by Vercel Cron (see vercel.json):
//  - processed_events is a short-lived EventSub idempotency cache; nothing
//    ever reads a row older than the ~10-minute replay window, so anything
//    past a day is pure bloat.
//  - Rejected submissions are dead ends nobody revisits; old ones just add
//    noise to per-stream storage. Approved/played/pending are untouched —
//    played history and its show_notes stay intact.
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

  if (eventsErr) console.error('cleanup: processed_events failed:', eventsErr.message);
  if (rejectedErr) console.error('cleanup: rejected submissions failed:', rejectedErr.message);

  return NextResponse.json({
    ok: !eventsErr && !rejectedErr,
    processedEventsDeleted: eventsDeleted ?? 0,
    rejectedSubmissionsDeleted: rejectedDeleted ?? 0,
  });
}
