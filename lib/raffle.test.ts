import { describe, expect, it } from 'vitest';
import {
  buildClosedMessage,
  buildStartMessage,
  buildWinnersMessage,
  DEFAULT_RAFFLE_COMMAND,
  drawWinners,
  isRaffleExpired,
  MAX_DURATION_SECONDS,
  MAX_WINNER_COUNT,
  MIN_DURATION_SECONDS,
  matchRaffleCommand,
  rerollWinner,
  sanitizeDurationSeconds,
  sanitizeRaffleCommand,
  sanitizeWinnerCount,
} from './raffle';

describe('sanitizeDurationSeconds', () => {
  it('clamps below the floor rather than rejecting', () => {
    expect(sanitizeDurationSeconds(1)).toBe(MIN_DURATION_SECONDS);
    expect(sanitizeDurationSeconds(0)).toBe(MIN_DURATION_SECONDS);
    expect(sanitizeDurationSeconds(-30)).toBe(MIN_DURATION_SECONDS);
  });

  it('clamps above the ceiling rather than rejecting', () => {
    // The typo case this exists for: someone means 60 seconds and types 6000.
    expect(sanitizeDurationSeconds(6000)).toBe(MAX_DURATION_SECONDS);
  });

  it('leaves an in-range value untouched', () => {
    expect(sanitizeDurationSeconds(120)).toBe(120);
  });

  it('rounds a fractional value', () => {
    expect(sanitizeDurationSeconds(90.6)).toBe(91);
  });

  it('falls back to the floor for non-numeric input', () => {
    for (const bad of [null, undefined, 'abc', {}, NaN]) {
      expect(sanitizeDurationSeconds(bad)).toBe(MIN_DURATION_SECONDS);
    }
  });
});

describe('sanitizeWinnerCount', () => {
  it('floors at 1 — a raffle with zero winners requested makes no sense', () => {
    expect(sanitizeWinnerCount(0)).toBe(1);
    expect(sanitizeWinnerCount(-5)).toBe(1);
  });

  it('caps at MAX_WINNER_COUNT', () => {
    expect(sanitizeWinnerCount(9999)).toBe(MAX_WINNER_COUNT);
  });

  it('falls back to 1 for non-numeric input', () => {
    for (const bad of [null, undefined, 'abc', {}]) expect(sanitizeWinnerCount(bad)).toBe(1);
  });
});

describe('sanitizeRaffleCommand', () => {
  it('adds a leading ! if the operator left it off', () => {
    expect(sanitizeRaffleCommand('enter')).toBe('!enter');
  });

  it('leaves an already-banged command alone', () => {
    expect(sanitizeRaffleCommand('!giveaway')).toBe('!giveaway');
  });

  it('trims and collapses whitespace', () => {
    expect(sanitizeRaffleCommand('  !win   now  ')).toBe('!win now');
  });

  it('falls back to the default for empty or non-string input', () => {
    for (const bad of ['', '   ', null, undefined, 42]) {
      expect(sanitizeRaffleCommand(bad)).toBe(DEFAULT_RAFFLE_COMMAND);
    }
  });
});

describe('matchRaffleCommand', () => {
  it('matches case-insensitively, trimmed', () => {
    expect(matchRaffleCommand('  !ENTER  ', '!enter')).toBe(true);
  });

  it('does not match a prefix — unlike a question, entry carries no payload', () => {
    expect(matchRaffleCommand('!enter please pick me', '!enter')).toBe(false);
  });

  it('does not match an unrelated message', () => {
    expect(matchRaffleCommand('hello chat', '!enter')).toBe(false);
  });
});

describe('isRaffleExpired', () => {
  const now = Date.UTC(2026, 7, 2, 12, 0, 0);

  it('is false before closes_at', () => {
    expect(isRaffleExpired(new Date(now + 1000).toISOString(), now)).toBe(false);
  });

  it('is true at or after closes_at', () => {
    expect(isRaffleExpired(new Date(now).toISOString(), now)).toBe(true);
    expect(isRaffleExpired(new Date(now - 1000).toISOString(), now)).toBe(true);
  });

  it('does not treat an unparseable timestamp as expired', () => {
    expect(isRaffleExpired('not a date', now)).toBe(false);
  });
});

describe('drawWinners', () => {
  it('never returns more winners than entrants', () => {
    expect(drawWinners(['a', 'b'], 5)).toHaveLength(2);
  });

  it('returns exactly the requested count when there are enough entrants', () => {
    expect(drawWinners(['a', 'b', 'c', 'd'], 2)).toHaveLength(2);
  });

  it('returns nothing from an empty pool', () => {
    expect(drawWinners([], 3)).toEqual([]);
  });

  it('never picks the same entrant twice', () => {
    const entrants = Array.from({ length: 30 }, (_, i) => `user${i}`);
    const winners = drawWinners(entrants, 10);
    expect(new Set(winners).size).toBe(winners.length);
  });

  it('only ever returns entrants who were actually in the pool', () => {
    const entrants = ['a', 'b', 'c'];
    const winners = drawWinners(entrants, 2);
    for (const w of winners) expect(entrants).toContain(w);
  });

  // Not a proof of fairness, just a smoke test that every entrant CAN win —
  // guards against an off-by-one that always favors one end of the array.
  it('gives every entrant a chance across repeated draws', () => {
    const entrants = ['a', 'b', 'c', 'd', 'e'];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      for (const w of drawWinners(entrants, 1)) seen.add(w);
      if (seen.size === entrants.length) break;
    }
    expect(seen.size).toBe(entrants.length);
  });
});

describe('rerollWinner', () => {
  it('returns null if the target is not a current winner', () => {
    expect(rerollWinner(['a', 'b', 'c'], ['b'], 'a')).toBeNull();
  });

  it('returns null when every entrant already won', () => {
    expect(rerollWinner(['a', 'b'], ['a', 'b'], 'a')).toBeNull();
  });

  it('draws a replacement from entrants who are not a current winner', () => {
    const replacement = rerollWinner(['a', 'b', 'c'], ['a'], 'a');
    expect(replacement).not.toBeNull();
    expect(['b', 'c']).toContain(replacement);
  });

  it('never redraws another current winner in a multi-winner raffle', () => {
    const entrants = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 50; i++) {
      const replacement = rerollWinner(entrants, ['a', 'b'], 'a');
      expect(replacement).not.toBe('b');
    }
  });

  it('matches the target case-insensitively', () => {
    expect(rerollWinner(['a', 'b'], ['A'], 'a')).not.toBeNull();
  });
});

describe('chat message copy', () => {
  it('states the command, winner count, and duration', () => {
    const msg = buildStartMessage('!enter', 90, 2);
    expect(msg).toContain('!enter');
    expect(msg).toContain('2 winners');
    expect(msg).toContain('2 minutes');
  });

  it('singularizes one winner and rounds sub-minute durations to seconds', () => {
    const msg = buildStartMessage('!enter', 30, 1);
    expect(msg).toContain('1 winner');
    expect(msg).not.toContain('1 winners');
    expect(msg).toContain('30s');
  });

  it('announces a subs/VIPs-only restriction up front, not by default', () => {
    expect(buildStartMessage('!enter', 90, 1)).not.toContain('subs');
    const msg = buildStartMessage('!enter', 90, 1, true);
    expect(msg).toContain('subs & VIPs only');
    // Announced right after the command, not buried at the end.
    expect(msg.indexOf('subs & VIPs only')).toBeLessThan(msg.indexOf('will be drawn'));
  });

  it('reports a real entrant count on close', () => {
    expect(buildClosedMessage(5)).toContain('5 entries');
    expect(buildClosedMessage(1)).toContain('1 entry');
  });

  it('says plainly when nobody entered, rather than "0 entries"', () => {
    const msg = buildClosedMessage(0);
    expect(msg).toContain('nobody entered');
  });

  it('lists every winner by @name', () => {
    const msg = buildWinnersMessage(['alice', 'bob']);
    expect(msg).toContain('@alice');
    expect(msg).toContain('@bob');
  });

  it('singularizes "winner" for one winner', () => {
    expect(buildWinnersMessage(['alice'])).toContain('winner is');
  });

  it('has distinct copy for zero winners', () => {
    expect(buildWinnersMessage([])).toContain('no winners');
  });
});
