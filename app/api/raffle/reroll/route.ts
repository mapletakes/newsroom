import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { rerollWinner } from '@/lib/raffle';
import { broadcastRaffleChange } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

/**
 * Replaces one drawn winner with a newly-drawn one on the stream's most
 * recently closed raffle — see lib/raffle.ts's rerollWinner for the draw
 * itself. Clears winners_announced_at on success, same reasoning as a
 * failed chat post in /api/raffle/announce: whatever was (or wasn't yet)
 * posted no longer reflects the real winner list, so the operator has to
 * hit "Announce to chat" again to correct it.
 */
export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const target = String(body.winnerLogin || '').toLowerCase();
  if (!target) return NextResponse.json({ error: 'missing winnerLogin' }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: raffle } = await sb
    .from('raffles')
    .select('id, status')
    .eq('stream_id', session.streamId)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!raffle || raffle.status !== 'closed') {
    return NextResponse.json({ error: 'no closed raffle to reroll' }, { status: 404 });
  }

  const { data: entryRows } = await sb
    .from('raffle_entries')
    .select('chatter_login, is_winner')
    .eq('raffle_id', raffle.id);
  const entrants = (entryRows ?? []).map((e) => e.chatter_login);
  const currentWinners = (entryRows ?? []).filter((e) => e.is_winner).map((e) => e.chatter_login);

  const newWinner = rerollWinner(entrants, currentWinners, target);
  if (!newWinner) {
    return NextResponse.json({ error: 'no eligible entrants left to draw' }, { status: 409 });
  }

  // Conditional on is_winner still being true: guards the same double-click
  // race every other lifecycle write in this file guards against.
  const { data: unset } = await sb
    .from('raffle_entries')
    .update({ is_winner: false })
    .eq('raffle_id', raffle.id)
    .eq('chatter_login', target)
    .eq('is_winner', true)
    .select('id')
    .maybeSingle();
  if (!unset) {
    return NextResponse.json({ error: 'that entrant is no longer a winner' }, { status: 409 });
  }
  await sb.from('raffle_entries').update({ is_winner: true }).eq('raffle_id', raffle.id).eq('chatter_login', newWinner);
  await sb.from('raffles').update({ winners_announced_at: null }).eq('id', raffle.id);

  broadcastRaffleChange(session.streamId);
  return NextResponse.json({ ok: true, oldWinner: target, newWinner });
}
