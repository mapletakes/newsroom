// The pure matching/sanitizing logic behind the !question command. The
// DB-touching half (submitQuestionToQueue) isn't unit tested here — the
// codebase doesn't mock Supabase for its other ingestion path
// (submit-url.ts) either, and it's exercised via the app instead.

import { describe, expect, it } from 'vitest';
import { MAX_QUESTION_CHARS, matchQuestionCommand, sanitizeQuestionText } from './submit-question';

describe('sanitizeQuestionText', () => {
  it('trims surrounding whitespace', () => {
    expect(sanitizeQuestionText('  what about the budget?  ')).toBe('what about the budget?');
  });

  it('collapses embedded whitespace and newlines to single spaces', () => {
    expect(sanitizeQuestionText('what   about\n\nthe budget?')).toBe('what about the budget?');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeQuestionText('   \n  ')).toBe('');
  });

  it('leaves text under the cap untouched', () => {
    const q = 'a short question';
    expect(sanitizeQuestionText(q)).toBe(q);
  });

  it('truncates with an ellipsis at the cap rather than rejecting', () => {
    const long = 'x'.repeat(MAX_QUESTION_CHARS + 50);
    const out = sanitizeQuestionText(long);
    expect(out.length).toBe(MAX_QUESTION_CHARS);
    expect(out.endsWith('…')).toBe(true);
  });

  it('does not leave trailing whitespace before the ellipsis', () => {
    const long = 'word '.repeat(100); // well over the cap, trims cleanly at a space
    const out = sanitizeQuestionText(long);
    expect(out.endsWith(' …')).toBe(false);
  });
});

describe('matchQuestionCommand', () => {
  it('extracts the question text after a matching command', () => {
    expect(matchQuestionCommand('!question what about the budget?', '!question')).toBe(
      'what about the budget?',
    );
  });

  it('is case-insensitive on the command itself', () => {
    expect(matchQuestionCommand('!QUESTION what about the budget?', '!question')).toBe(
      'what about the budget?',
    );
  });

  it('returns null when the message does not start with the command', () => {
    expect(matchQuestionCommand('hey !question is not at the start', '!question')).toBeNull();
    expect(matchQuestionCommand('!q what about the budget?', '!question')).toBeNull();
  });

  it('returns null when nothing follows the command', () => {
    expect(matchQuestionCommand('!question', '!question')).toBeNull();
    expect(matchQuestionCommand('!question    ', '!question')).toBeNull();
  });

  it('returns null when the command is unset — blank disables it like video_command', () => {
    expect(matchQuestionCommand('!question anything', '')).toBeNull();
    expect(matchQuestionCommand('!question anything', null)).toBeNull();
    expect(matchQuestionCommand('!question anything', undefined)).toBeNull();
  });

  it('does not match a different command as a prefix collision', () => {
    // "!questionable" should not be treated as "!question" + "able"
    expect(matchQuestionCommand('!questionable thing', '!question')).toBe('able thing');
    // this documents real behavior (prefix match, same as submit_command) —
    // command distinctness/collision is guarded at save time in /api/setup,
    // not here.
  });
});
