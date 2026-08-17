import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession, getApprovedSession } from '@/lib/session';
import {
  closeIfExpired,
  sanitizeDurationSeconds,
  sanitizeRaffleCommand,
  sanitizeWinnerCount,
  buildStartMessage,
} from '@/lib/raffle';
import { announcePlainMessage } from '@/lib/announce';
import { broadcastRaffleChange } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

async function raffleEnabledFor(streamId: string): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data } = await sb.from('streams').select('raffle_enabled').eq('id', streamId).maybeSingle();
  return data?.raffle_enabled === true;
}

/** The current (or most recently run) raffle for this stream, if any — open
 *  to the streamer and any mod, same "the team can see each other's work"
 *  reasoning as the mod-status roster and the questions panel. Starting a
 *  new raffle naturally supersedes an old closed one here (ordered by
 *  opened_at desc), so there's no separate "dismiss" action needed. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await raffleEnabledFor(session.streamId))) {
    return NextResponse.json({ error: 'raffle not enabled' }, { status: 403 });
  }

  // Lazily close before reading, same pattern as mod-status's 12h reset —
  // see lib/raffle.ts on closeIfExpired for why there's no scheduled job
  // doing this on the tick instead.
  await closeIfExpired(session.streamId);

  const sb = supabaseAdmin();
  const { data: raffle, error } = await sb
    .from('raffles')
    .select('id, command, winner_count, status, opened_at, closes_at, closed_at, winners_announced_at, started_by_login, subs_vips_only')
    .eq('stream_id', session.streamId)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!raffle) return NextResponse.json({ raffle: null });

  const { count: entryCount } = await sb
    .from('raffle_entries')
    .select('*', { count: 'exact', head: true })
    .eq('raffle_id', raffle.id);

  // Winner names only ever fetched once closed — while open there are none
  // to fetch, and it saves a query on the common "raffle is running" poll.
  let winners: string[] = [];
  if (raffle.status === 'closed') {
    const { data: rows } = await sb
      .from('raffle_entries')
      .select('chatter_login')
      .eq('raffle_id', raffle.id)
      .eq('is_winner', true)
      .order('chatter_login', { ascending: true });
    winners = (rows ?? []).map((r) => r.chatter_login);
  }

  return NextResponse.json({
    raffle: {
      id: raffle.id,
      command: raffle.command,
      winnerCount: raffle.winner_count,
      status: raffle.status,
      openedAt: raffle.opened_at,
      closesAt: raffle.closes_at,
      closedAt: raffle.closed_at,
      winnersAnnouncedAt: raffle.winners_announced_at,
      startedByLogin: raffle.started_by_login,
      subsVipsOnly: raffle.subs_vips_only === true,
      entryCount: entryCount ?? 0,
      winners,
    },
  });
}

/**
 * Start a raffle. There is deliberately no settings-tab configuration to
 * read here — command, duration, and winner count are entirely decided by
 * this one request (see schema.sql on public.raffles), sanitized the same
 * way whatever the caller sent, rather than validated-and-rejected — a
 * clamped duration is a better failure mode than a form error on a control
 * meant to be a single click.
 */
export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await raffleEnabledFor(session.streamId))) {
    return NextResponse.json({ error: 'raffle not enabled' }, { status: 403 });
  }

  const sb = supabaseAdmin();

  // One raffle at a time per stream — the row shape doesn't prevent a
  // second, this check does. Checked here rather than relied on as a DB
  // constraint because "already running" needs a specific, actionable error
  // message, not a generic insert failure.
  const { data: existing } = await sb
    .from('raffles')
    .select('id')
    .eq('stream_id', session.streamId)
    .eq('status', 'open')
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: 'a raffle is already running' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const command = sanitizeRaffleCommand(body.command);
  const durationSeconds = sanitizeDurationSeconds(body.durationSeconds);
  const winnerCount = sanitizeWinnerCount(body.winnerCount);
  const subsVipsOnly = !!body.subsVipsOnly;
  const closesAt = new Date(Date.now() + durationSeconds * 1000).toISOString();

  const { data: raffle, error } = await sb
    .from('raffles')
    .insert({
      stream_id: session.streamId,
      command,
      winner_count: winnerCount,
      status: 'open',
      closes_at: closesAt,
      started_by_login: session.twitchLogin,
      subs_vips_only: subsVipsOnly,
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: stream } = await sb
    .from('streams')
    .select('id, twitch_user_id')
    .eq('id', session.streamId)
    .maybeSingle();
  if (stream) {
    // Sent as the channel's own account, not the operator's — see
    // closeRaffleAndAnnounce's doc comment on why every raffle lifecycle
    // message uses the same voice regardless of who triggered it.
    await announcePlainMessage(
      stream.id,
      stream.twitch_user_id,
      stream.twitch_user_id,
      buildStartMessage(command, durationSeconds, winnerCount, subsVipsOnly),
    ).catch((err) => console.error('raffle start announcement failed:', err));
  }

  broadcastRaffleChange(session.streamId);
  return NextResponse.json({ ok: true, raffleId: raffle.id });
}
