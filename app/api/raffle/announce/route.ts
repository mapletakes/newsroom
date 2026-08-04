import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { buildWinnersMessage } from '@/lib/raffle';
import { announcePlainMessage } from '@/lib/announce';
import { broadcastRaffleChange } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

/**
 * Posts the drawn winners to chat — always a deliberate click, never
 * automatic (see public.raffles.winners_announced_at in schema.sql for why
 * this is a separate step from closing). Operates on the stream's most
 * recently closed raffle rather than taking an id in the body: the panel
 * only ever has one raffle in view at a time, so there's nothing an id
 * would disambiguate that this session's own streamId doesn't already.
 */
export async function POST() {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sb = supabaseAdmin();
  const { data: raffle } = await sb
    .from('raffles')
    .select('id, status, winners_announced_at')
    .eq('stream_id', session.streamId)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!raffle || raffle.status !== 'closed') {
    return NextResponse.json({ error: 'no closed raffle to announce' }, { status: 404 });
  }

  // Conditional on winners_announced_at still being null, same atomicity
  // reasoning as closeRaffleAndAnnounce's status='open' guard: a doubled
  // click (or two people on the panel at once) must post the winners to
  // chat exactly once, not twice.
  const { data: claimed } = await sb
    .from('raffles')
    .update({ winners_announced_at: new Date().toISOString() })
    .eq('id', raffle.id)
    .is('winners_announced_at', null)
    .select('id')
    .maybeSingle();
  if (!claimed) {
    return NextResponse.json({ error: 'winners were already announced' }, { status: 409 });
  }

  const { data: winnerRows } = await sb
    .from('raffle_entries')
    .select('chatter_login')
    .eq('raffle_id', raffle.id)
    .eq('is_winner', true)
    .order('chatter_login', { ascending: true });
  const winners = (winnerRows ?? []).map((w) => w.chatter_login);

  const { data: stream } = await sb
    .from('streams')
    .select('id, twitch_user_id')
    .eq('id', session.streamId)
    .maybeSingle();

  const result = stream
    ? await announcePlainMessage(stream.id, stream.twitch_user_id, stream.twitch_user_id, buildWinnersMessage(winners))
    : { ok: false as const, error: 'stream not found' };

  if (!result.ok) {
    console.error('raffle winners announcement failed:', result.error);
    // Release the claim rather than leave it set: a failed post (token
    // needs reconnecting, a transient Twitch error) has to be retryable, and
    // the 409 guard above would otherwise permanently lock this raffle out
    // of ever posting its winners over what might be a one-off blip.
    await sb.from('raffles').update({ winners_announced_at: null }).eq('id', raffle.id);
    return NextResponse.json(
      { error: 'send failed', detail: result.error === 'reconnect' ? 'Chat posting needs reauthorization — sign out and back in.' : result.error },
      { status: 502 },
    );
  }

  broadcastRaffleChange(session.streamId);
  return NextResponse.json({ ok: true, winners });
}
