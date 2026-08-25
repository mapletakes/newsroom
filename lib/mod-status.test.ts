// Status values and notes arrive as whatever a mod typed or a client posted,
// and end up on a board the whole mod team reads at a glance. The sanitizers
// are what stand between those two facts.

import { describe, expect, it } from 'vitest';
import {
  isRosterInactive,
  isStatusStale,
  MAX_STATUS_NOTE_CHARS,
  MOD_STATUSES,
  MOD_STATUS_LABELS,
  MOD_STATUS_SHORT,
  MOD_STATUS_TOKEN,
  ROSTER_INACTIVE_AFTER_MS,
  sanitizeModStatus,
  sanitizeStatusNote,
  STATUS_RESET_AFTER_MS,
  STATUS_STALE_AFTER_MS,
} from './mod-status';

describe('sanitizeModStatus', () => {
  it('accepts each of the three real statuses', () => {
    for (const s of MOD_STATUSES) expect(sanitizeModStatus(s)).toBe(s);
  });

  it('maps anything unrecognised to null rather than guessing', () => {
    for (const bad of ['GREEN', 'grey', 'available', '', 'null', 42, null, undefined, {}, ['green']]) {
      expect(sanitizeModStatus(bad)).toBeNull();
    }
  });

  it('treats null as a first-class "hasn\'t said" rather than a status', () => {
    // Storing absence as null (not a fourth enum member) is what lets the UI
    // distinguish "no claim" from "claims unavailable".
    expect(sanitizeModStatus(null)).toBeNull();
    expect((MOD_STATUSES as readonly string[]).includes('unset')).toBe(false);
  });
});

describe('status presentation tables', () => {
  it('covers every status in all three lookup tables', () => {
    for (const s of MOD_STATUSES) {
      expect(MOD_STATUS_LABELS[s]).toBeTruthy();
      expect(MOD_STATUS_SHORT[s]).toBeTruthy();
      expect(MOD_STATUS_TOKEN[s]).toBeTruthy();
    }
  });

  it('uses palette tokens, not raw colours, so stream themes still apply', () => {
    for (const s of MOD_STATUSES) {
      expect(MOD_STATUS_TOKEN[s]).not.toMatch(/^#|rgb/);
    }
  });
});

describe('sanitizeStatusNote', () => {
  it('trims and collapses whitespace', () => {
    expect(sanitizeStatusNote('  back   in\n\n20  ')).toBe('back in 20');
  });

  it('returns null for empty or whitespace-only input, so clearing works', () => {
    expect(sanitizeStatusNote('')).toBeNull();
    expect(sanitizeStatusNote('    ')).toBeNull();
    expect(sanitizeStatusNote('\n\t')).toBeNull();
  });

  it('returns null for non-strings', () => {
    for (const bad of [null, undefined, 42, {}, []]) expect(sanitizeStatusNote(bad)).toBeNull();
  });

  it('leaves a normal note untouched', () => {
    const note = 'putting the kid down, back in 20';
    expect(sanitizeStatusNote(note)).toBe(note);
  });

  it('truncates an over-long note with an ellipsis rather than rejecting it', () => {
    const out = sanitizeStatusNote('x'.repeat(MAX_STATUS_NOTE_CHARS + 40))!;
    expect(out.length).toBe(MAX_STATUS_NOTE_CHARS);
    expect(out.endsWith('…')).toBe(true);
  });

  it('does not leave a dangling space before the ellipsis', () => {
    const out = sanitizeStatusNote('word '.repeat(60))!;
    expect(out.endsWith(' …')).toBe(false);
  });
});

describe('isStatusStale', () => {
  const now = Date.UTC(2026, 7, 2, 12, 0, 0);
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('treats a never-set status as absent, not stale', () => {
    expect(isStatusStale(null, now)).toBe(false);
    expect(isStatusStale(undefined, now)).toBe(false);
  });

  it('is false just inside the window and true just outside it', () => {
    expect(isStatusStale(ago(STATUS_STALE_AFTER_MS - 60_000), now)).toBe(false);
    expect(isStatusStale(ago(STATUS_STALE_AFTER_MS + 60_000), now)).toBe(true);
  });

  it('flags the case this whole feature hinges on — a green set hours ago', () => {
    expect(isStatusStale(ago(4 * 60 * 60 * 1000), now)).toBe(true);
  });

  it('does not treat an unparseable timestamp as stale', () => {
    // Better to show it plainly than to label it stale on a parse failure.
    expect(isStatusStale('not a date', now)).toBe(false);
  });
});

describe('STATUS_RESET_AFTER_MS', () => {
  it('is 12 hours, and strictly longer than the dim-only stale window', () => {
    // The two constants encode different intents (dim-and-nudge vs.
    // actually clear it out) — reset must never fire before stale does.
    expect(STATUS_RESET_AFTER_MS).toBe(12 * 60 * 60 * 1000);
    expect(STATUS_RESET_AFTER_MS).toBeGreaterThan(STATUS_STALE_AFTER_MS);
  });
});

describe('isRosterInactive', () => {
  const now = Date.UTC(2026, 7, 2, 12, 0, 0);
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('treats a mod who has never set a status as inactive — nothing to show for them', () => {
    expect(isRosterInactive(null, now)).toBe(true);
    expect(isRosterInactive(undefined, now)).toBe(true);
  });

  it('is 96 hours, and strictly longer than the 12-hour value-reset window', () => {
    // Different questions on purpose: reset is "is the status value still
    // current", this is "is the account still worth showing at all" — the
    // roster window must outlast the reset window, not line up with it.
    expect(ROSTER_INACTIVE_AFTER_MS).toBe(96 * 60 * 60 * 1000);
    expect(ROSTER_INACTIVE_AFTER_MS).toBeGreaterThan(STATUS_RESET_AFTER_MS);
  });

  it('is false just inside the window and true just outside it', () => {
    expect(isRosterInactive(ago(ROSTER_INACTIVE_AFTER_MS - 60_000), now)).toBe(false);
    expect(isRosterInactive(ago(ROSTER_INACTIVE_AFTER_MS + 60_000), now)).toBe(true);
  });

  it('flags the case this exists for — a mod who set a status days ago and never came back', () => {
    expect(isRosterInactive(ago(10 * 24 * 60 * 60 * 1000), now)).toBe(true);
  });

  it('does not treat an unparseable timestamp as active', () => {
    expect(isRosterInactive('not a date', now)).toBe(true);
  });
});
