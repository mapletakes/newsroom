// Chat raffles: !enter-style entry collection with a timer, a random draw,
// and an announce-to-chat step the operator triggers deliberately. See
// schema.sql on public.raffles for why there's no persistent settings-tab
// configuration and no scheduled job ending one on the tick.

import { supabaseAdmin } from './supabase';
import { announcePlainMessage } from './announce';
import { broadcastRaffleChange } from './realtime';
import { checkRateLimit, hashKey } from './ratelimit';

export const DEFAULT_RAFFLE_COMMAND = '!enter';
export const MIN_DURATION_SECONDS = 15;
export const MAX_DURATION_SECONDS = 60 * 60; // 1 hour — long enough for any real giveaway, short enough that an operator who walks away doesn't leave one open all night.
export const MAX_WINNER_COUNT = 50;

export type RaffleStatus = 'open' | 'closed';

/** Clamps to [MIN_DURATION_SECONDS, MAX_DURATION_SECONDS] rather than
 *  rejecting an out-of-range value — a typo'd "6000 seconds" is far more
 *  likely than a deliberate hour-plus raffle, and clamping keeps the start
 *  action a single click instead of a round trip to fix a validation error. */
export function sanitizeDurationSeconds(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return MIN_DURATION_SECONDS;
  return Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, Math.round(n)));
}

export function sanitizeWinnerCount(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_WINNER_COUNT, Math.max(1, Math.round(n)));
}

/** Trim, collapse whitespace, cap at a sane length, and guarantee a leading
 *  "!" — chatters type commands with the bang; an operator who typed
 *  "enter" instead of "!enter" almost certainly meant the same command, not
 *  a literal word chat has to match without it. Falls back to the default
 *  for anything left empty after cleanup. */
export function sanitizeRaffleCommand(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_RAFFLE_COMMAND;
  let cmd = raw.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!cmd) return DEFAULT_RAFFLE_COMMAND;
  if (!cmd.startsWith('!')) cmd = `!${cmd}`;
  return cmd;
}

/**
 * Exact match, like video_command — a raffle entry command carries no
 * payload, so "starts with" would also match someone typing the command
 * followed by unrelated text (e.g. asking "!enter to win what?"), counting
 * that as an entry when it wasn't meant as one.
 */
export function matchRaffleCommand(messageText: string, command: string): boolean {
  return messageText.trim().toLowerCase() === command.toLowerCase();
}

export function isRaffleExpired(closesAt: string, now = Date.now()): boolean {
  const t = new Date(closesAt).getTime();
  if (Number.isNaN(t)) return false;
  return now >= t;
}

/**
 * Fisher-Yates, then take the front — every entrant has an equal chance
 * regardless of entry order, and this never returns more winners than there
 * are entrants (the caller's requested count is a ceiling, not a guarantee).
 * Pure and exported specifically so the distribution is unit-testable
 * without a database.
 */
export function drawWinners(entrants: string[], count: number): string[] {
  const pool = [...entrants];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

/**
 * Swaps out one drawn winner for a newly-drawn one — for when a winner
 * already has the prize, declines it, or doesn't respond, without reopening
 * entries and asking chat to enter again. Draws uniformly from entrants who
 * aren't a CURRENT winner, so a reroll's odds match the original draw's
 * (nobody can win twice in the same raffle, but a name that already lost
 * once is exactly as eligible as anyone else who hasn't won).
 *
 * Returns null if there's nobody left to draw — either target isn't
 * (anymore) a winner (a stale client, or a second click after someone else's
 * reroll already replaced them), or every entrant already won.
 */
export function rerollWinner(entrants: string[], currentWinners: string[], target: string): string | null {
  const targetLower = target.toLowerCase();
  if (!currentWinners.some((w) => w.toLowerCase() === targetLower)) return null;

  const winnerSet = new Set(currentWinners.map((w) => w.toLowerCase()));
  const pool = entrants.filter((e) => !winnerSet.has(e.toLowerCase()));
  if (pool.length === 0) return null;

  return pool[Math.floor(Math.random() * pool.length)];
}

// subsVipsOnly is announced up front rather than left for chatters to
// discover by their !enter silently doing nothing — see handleRaffleEntry,
// which gates entry the same way with no chat feedback either way.
export function buildStartMessage(
  command: string,
  durationSeconds: number,
  winnerCount: number,
  subsVipsOnly = false,
): string {
  const mins = Math.round(durationSeconds / 60);
  const when = durationSeconds < 60 ? `${durationSeconds}s` : `${mins} minute${mins === 1 ? '' : 's'}`;
  const who = winnerCount === 1 ? '1 winner' : `${winnerCount} winners`;
  const restriction = subsVipsOnly ? ' (subs & VIPs only)' : '';
  return `Raffle started! Type ${command} to enter${restriction} — ${who} will be drawn in ${when}.`;
}

export function buildClosedMessage(entrantCount: number): string {
  if (entrantCount === 0) return `Raffle closed — nobody entered.`;
  return `Raffle closed! ${entrantCount} ${entrantCount === 1 ? 'entry' : 'entries'}. Drawing winner${entrantCount === 1 ? '' : 's'}…`;
}

export function buildWinnersMessage(winners: string[]): string {
  if (winners.length === 0) return `Raffle ended with no entrants — no winners this time.`;
  const names = winners.map((w) => `@${w}`).join(', ');
  return winners.length === 1 ? `The winner is: ${names}!` : `The winners are: ${names}!`;
}

/**
 * Closes an open raffle IF it's still open by the time this runs — the
 * update's WHERE clause (`status = 'open'`) is what makes this atomic. Two
 * requests can both notice the same expired raffle at nearly the same
 * instant (a chat message arriving via EventSub and a mod's panel polling
 * GET /api/raffle), and only one may win the race to close it; the other's
 * conditional update simply touches zero rows. Without that guard both
 * would draw winners and both would post to chat, doubling the
 * announcement.
 *
 * Draws winners and posts the "closed" + "winners" chat messages as the
 * streamer's own account, same as the !video auto-responder — this is a
 * channel-lifecycle event, not a personal action, and using the streamer's
 * token sidesteps needing every mod who might trigger it (including via a
 * background poll, unattended) to have their own valid chat-send token.
 *
 * Returns null if this call didn't win the race (someone already closed it)
 * or the raffle wasn't found; otherwise the closed raffle's id and winners.
 */
export async function closeRaffleAndAnnounce(
  streamId: string,
  raffleId: string,
): Promise<{ id: string; winners: string[] } | null> {
  const sb = supabaseAdmin();

  const { data: closed } = await sb
    .from('raffles')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', raffleId)
    .eq('stream_id', streamId)
    .eq('status', 'open')
    .select('id, winner_count')
    .maybeSingle();
  if (!closed) return null; // lost the race, or no such open raffle

  const { data: entries } = await sb
    .from('raffle_entries')
    .select('chatter_login')
    .eq('raffle_id', raffleId);
  const entrants = (entries ?? []).map((e) => e.chatter_login);
  const winners = drawWinners(entrants, closed.winner_count);

  if (winners.length > 0) {
    await sb.from('raffle_entries').update({ is_winner: true }).eq('raffle_id', raffleId).in('chatter_login', winners);
  }

  const { data: stream } = await sb
    .from('streams')
    .select('id, twitch_user_id')
    .eq('id', streamId)
    .maybeSingle();
  if (stream) {
    await announcePlainMessage(stream.id, stream.twitch_user_id, stream.twitch_user_id, buildClosedMessage(entrants.length)).catch(
      (err) => console.error('raffle close announcement failed:', err),
    );
  }

  broadcastRaffleChange(streamId).catch(() => {});
  return { id: closed.id, winners };
}

/**
 * Chat-message entry point for raffles — called from the EventSub handler
 * for every message on a stream with raffle_enabled, so it starts with one
 * cheap select and returns immediately if there's no open raffle, rather
 * than needing the caller to pre-check that itself.
 *
 * There is no settings-stored command to match against (see schema.sql):
 * the currently open raffle's own `command` column is the only source of
 * truth, fetched fresh on every message rather than cached, since a raffle
 * lives minutes and the extra query is cheap next to everything else this
 * handler already does per message.
 *
 * `isSub`/`isVip` are the chat message's own badges (already parsed by the
 * caller for other purposes), checked against at the moment of entry — see
 * schema.sql on subs_vips_only for why that's a deliberate, not-revisited
 * choice rather than re-checked at draw time.
 */
export async function handleRaffleEntry(
  streamId: string,
  messageText: string,
  chatterLogin: string,
  isSub: boolean,
  isVip: boolean,
): Promise<void> {
  const sb = supabaseAdmin();
  const { data: open } = await sb
    .from('raffles')
    .select('id, command, closes_at, subs_vips_only')
    .eq('stream_id', streamId)
    .eq('status', 'open')
    .maybeSingle();
  if (!open) return;

  // A raffle whose timer has run out but hasn't been lazily closed by
  // anything yet (see closeIfExpired) must not keep accepting entries just
  // because this message happened to arrive first — close it instead of
  // matching the command against it.
  if (isRaffleExpired(open.closes_at)) {
    await closeRaffleAndAnnounce(streamId, open.id);
    return;
  }

  if (!matchRaffleCommand(messageText, open.command)) return;

  // Silent, same as an ignored user's message — buildStartMessage already
  // announced the restriction up front, so there's nothing new to tell a
  // non-eligible chatter here.
  if (open.subs_vips_only && !(isSub || isVip)) return;

  // Belt-and-suspenders on top of the unique constraint below — see the
  // 'raffle' kind in lib/ratelimit.ts for why this is defense-in-depth
  // rather than the actual dedup mechanism.
  const limited = await checkRateLimit('raffle', hashKey(`${streamId}:${open.id}:${chatterLogin.toLowerCase()}`));
  if (!limited.ok) return;

  const { error } = await sb
    .from('raffle_entries')
    .insert({ raffle_id: open.id, stream_id: streamId, chatter_login: chatterLogin.toLowerCase() });
  if (error) {
    // 23505 = unique_violation: this chatter already entered. That's the
    // dedup mechanism working as intended, not a failure worth logging or
    // broadcasting a change for.
    if (error.code !== '23505') console.error('raffle entry insert failed:', error.message);
    return;
  }
  broadcastRaffleChange(streamId).catch(() => {});
}

/** If the stream's currently-open raffle (if any) has passed its closes_at,
 *  closes and announces it. Called before every read of raffle state (GET
 *  /api/raffle, the EventSub handler) so nothing ever displays or accepts
 *  entries against a raffle that should already be over — the alternative
 *  is trusting a scheduled job to flip the status on time, and this app has
 *  no scheduler finer than once a day. */
export async function closeIfExpired(streamId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { data: open } = await sb
    .from('raffles')
    .select('id, closes_at')
    .eq('stream_id', streamId)
    .eq('status', 'open')
    .maybeSingle();
  if (!open || !isRaffleExpired(open.closes_at)) return;
  await closeRaffleAndAnnounce(streamId, open.id);
}
