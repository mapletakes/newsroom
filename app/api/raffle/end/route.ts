import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { closeRaffleAndAnnounce } from '@/lib/raffle';

export const dynamic = 'force-dynamic';

/** Ends the stream's open raffle early, at the operator's request — for when
 *  entries have clearly tapered off and there's no reason to wait out the
 *  full timer. Goes through the same closeRaffleAndAnnounce as the lazy
 *  auto-close (draw, "closed" chat message, broadcast); the only difference
 *  is this call doesn't check closes_at first, so it can succeed before the
 *  timer's up. */
export async function POST() {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sb = supabaseAdmin();
  const { data: open } = await sb
    .from('raffles')
    .select('id')
    .eq('stream_id', session.streamId)
    .eq('status', 'open')
    .maybeSingle();
  if (!open) return NextResponse.json({ error: 'no raffle is running' }, { status: 404 });

  const result = await closeRaffleAndAnnounce(session.streamId, open.id);
  if (!result) {
    // Lost a race with something else closing it (the lazy check on a
    // concurrent GET, most likely) in the moment between the select above
    // and this call — not this request's failure to report as one.
    return NextResponse.json({ error: 'raffle was already closing' }, { status: 409 });
  }
  return NextResponse.json({ ok: true, winners: result.winners });
}
