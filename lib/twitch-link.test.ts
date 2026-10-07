import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./crypto', () => ({ encryptSecret: (s: string) => `enc(${s})` }));
vi.mock('./twitch-oauth', () => ({ fetchModeratedChannels: vi.fn() }));

import { linkTwitchToStream } from './twitch-link';

// A tiny chainable fake of the supabase query builder. Each `from(table)` call
// starts a builder whose first verb (select/update/delete) decides which queued
// result it resolves to, whether it ends in .maybeSingle() or is awaited.
type Result = { data?: unknown; error?: { code?: string } | null };
function fakeSb(queues: Record<string, Result[]>) {
  const calls: { table: string; op: string; args: unknown[]; filters: unknown[][] }[] = [];
  const sb = {
    from(table: string) {
      const call = { table, op: '', args: [] as unknown[], filters: [] as unknown[][] };
      calls.push(call);
      const next = (): Promise<Result> => {
        const q = queues[`${table}.${call.op}`];
        return Promise.resolve(q?.shift() ?? { data: null, error: null });
      };
      const b: Record<string, unknown> = {
        select: (...a: unknown[]) => ((call.op ||= 'select'), (call.args = a), b),
        update: (...a: unknown[]) => ((call.op = 'update'), (call.args = a), b),
        delete: (...a: unknown[]) => ((call.op = 'delete'), (call.args = a), b),
        eq: (...a: unknown[]) => (call.filters.push(['eq', ...a]), b),
        is: (...a: unknown[]) => (call.filters.push(['is', ...a]), b),
        maybeSingle: () => next(),
        then: (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej),
      };
      return b;
    },
  };
  return { sb: sb as never, calls };
}

const TOKENS = { access_token: 'at', refresh_token: 'rt', expires_in: 3600 };
const USER = { id: 'tw-1', login: 'streamer', display_name: 'Streamer' };
const base = { streamId: 's1', accountId: 'auth-1', tokens: TOKENS, user: USER };

describe('linkTwitchToStream', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attaches Twitch and encrypted tokens to the email stream, and moves prefs to the Twitch id', async () => {
    const { sb, calls } = fakeSb({
      'streams.select': [
        { data: { id: 's1', twitch_user_id: null } }, // current stream
        { data: null }, // no stream owns this Twitch id
      ],
      'streams.update': [{ error: null }],
      'user_prefs.select': [{ data: null }], // twitch id has no prefs yet
    });
    expect(await linkTwitchToStream({ sb, ...base })).toEqual({ ok: true });

    const upd = calls.find((c) => c.table === 'streams' && c.op === 'update')!;
    expect(upd.args[0]).toMatchObject({
      twitch_user_id: 'tw-1',
      twitch_login: 'streamer',
      display_name: 'Streamer',
      access_token: 'enc(at)',
      refresh_token: 'enc(rt)',
    });
    // Guarded so a lost race can't overwrite someone else's link.
    expect(upd.filters).toContainEqual(['is', 'twitch_user_id', null]);

    const prefs = calls.find((c) => c.table === 'user_prefs' && c.op === 'update')!;
    expect(prefs.args[0]).toMatchObject({ account_id: 'tw-1' });
    expect(prefs.filters).toContainEqual(['eq', 'account_id', 'auth-1']);
  });

  it('refuses when that Twitch account already has its own stream, changing nothing', async () => {
    const { sb, calls } = fakeSb({
      'streams.select': [{ data: { id: 's1', twitch_user_id: null } }, { data: { id: 'other' } }],
    });
    expect(await linkTwitchToStream({ sb, ...base })).toEqual({ ok: false, reason: 'taken' });
    expect(calls.some((c) => c.op === 'update' || c.op === 'delete')).toBe(false);
  });

  it('refuses when the stream is already linked', async () => {
    const { sb } = fakeSb({ 'streams.select': [{ data: { id: 's1', twitch_user_id: 'tw-0' } }] });
    expect(await linkTwitchToStream({ sb, ...base })).toEqual({ ok: false, reason: 'already-linked' });
  });

  it('maps a unique-violation from a concurrent claim to "taken"', async () => {
    const { sb } = fakeSb({
      'streams.select': [{ data: { id: 's1', twitch_user_id: null } }, { data: null }],
      'streams.update': [{ error: { code: '23505' } }],
    });
    expect(await linkTwitchToStream({ sb, ...base })).toEqual({ ok: false, reason: 'taken' });
  });

  it('keeps existing Twitch-id prefs and drops the email account prefs instead of overwriting', async () => {
    const { sb, calls } = fakeSb({
      'streams.select': [{ data: { id: 's1', twitch_user_id: null } }, { data: null }],
      'streams.update': [{ error: null }],
      'user_prefs.select': [{ data: { account_id: 'tw-1' } }],
    });
    expect(await linkTwitchToStream({ sb, ...base })).toEqual({ ok: true });
    expect(calls.some((c) => c.table === 'user_prefs' && c.op === 'update')).toBe(false);
    const del = calls.find((c) => c.table === 'user_prefs' && c.op === 'delete')!;
    expect(del.filters).toContainEqual(['eq', 'account_id', 'auth-1']);
  });
});
