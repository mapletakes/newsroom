import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  rowError: null as { message: string } | null,
  deletes: [] as [string, Record<string, unknown>][],
}));

vi.mock('./supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let deleting = false;
      const matches = () =>
        (state.tables[table] ?? []).filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v));
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.delete = () => {
        deleting = true;
        return chain;
      };
      chain.eq = (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      };
      chain.maybeSingle = async () => ({
        data: matches()[0] ?? null,
        error: table === 'moderators' ? state.rowError : null,
      });
      chain.then = (resolve: (v: unknown) => void) => {
        if (deleting) {
          state.deletes.push([table, { ...filters }]);
          const gone = matches();
          state.tables[table] = (state.tables[table] ?? []).filter((row) => !gone.includes(row));
        }
        resolve({ error: null });
      };
      return chain;
    },
  }),
}));
vi.mock('./announce', () => ({ getValidAccessToken: vi.fn(async () => 'mod-token') }));
vi.mock('./twitch-oauth', async (orig) => ({
  ...(await orig<typeof import('./twitch-oauth')>()),
  fetchModeratedChannels: vi.fn(async () => [{ broadcaster_id: '100' }]),
}));

import { getValidAccessToken } from './announce';
import { clearModAccessCache, modMembershipValid } from './mod-access';
import { TwitchApiError, fetchModeratedChannels } from './twitch-oauth';

const MINUTE = 60_000;

beforeEach(() => {
  clearModAccessCache();
  state.deletes = [];
  state.rowError = null;
  state.tables = {
    moderators: [{ stream_id: 's1', twitch_user_id: '200' }],
    streams: [
      { id: 's1', twitch_user_id: '100' },
      { id: 'own-200', twitch_user_id: '200' },
    ],
  };
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('modMembershipValid', () => {
  it('refuses anyone without a Twitch id', async () => {
    expect(await modMembershipValid('s1', undefined)).toBe(false);
  });

  it('refuses a person with no moderator row, without asking Twitch', async () => {
    state.tables.moderators = [];
    expect(await modMembershipValid('s1', '200')).toBe(false);
    expect(fetchModeratedChannels).not.toHaveBeenCalled();
  });

  it('admits a mod Twitch confirms, using their own token', async () => {
    expect(await modMembershipValid('s1', '200')).toBe(true);
    expect(getValidAccessToken).toHaveBeenCalledWith('own-200');
    expect(fetchModeratedChannels).toHaveBeenCalledWith('mod-token', '200', { strict: true });
  });

  it('remembers a confirmation for five minutes, then asks Twitch again', async () => {
    await modMembershipValid('s1', '200');
    vi.advanceTimersByTime(4 * MINUTE);
    expect(await modMembershipValid('s1', '200')).toBe(true);
    expect(fetchModeratedChannels).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2 * MINUTE);
    expect(await modMembershipValid('s1', '200')).toBe(true);
    expect(fetchModeratedChannels).toHaveBeenCalledTimes(2);
  });

  it('refuses, and forgets, a mod Twitch no longer lists', async () => {
    vi.mocked(fetchModeratedChannels).mockResolvedValueOnce([{ broadcaster_id: '999' }] as never);

    expect(await modMembershipValid('s1', '200')).toBe(false);

    expect(state.deletes).toEqual([['moderators', { stream_id: 's1', twitch_user_id: '200' }]]);
    // The row is gone, so the next request fails without another Twitch call.
    expect(await modMembershipValid('s1', '200')).toBe(false);
    expect(fetchModeratedChannels).toHaveBeenCalledTimes(1);
  });

  it('refuses a mod once they stop moderating, even after being confirmed', async () => {
    await modMembershipValid('s1', '200');
    vi.advanceTimersByTime(6 * MINUTE);
    vi.mocked(fetchModeratedChannels).mockResolvedValueOnce([] as never);

    expect(await modMembershipValid('s1', '200')).toBe(false);
  });

  it('refuses a mod whose token Twitch rejects, and does not ask again for half a minute', async () => {
    vi.mocked(fetchModeratedChannels).mockRejectedValueOnce(new TwitchApiError('revoked', 401));

    expect(await modMembershipValid('s1', '200')).toBe(false);
    // Revoking their own authorization must not be a way to keep access, and
    // it must not delete a row that may still be right.
    expect(state.deletes).toEqual([]);

    expect(await modMembershipValid('s1', '200')).toBe(false);
    expect(fetchModeratedChannels).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31_000);
    expect(await modMembershipValid('s1', '200')).toBe(true);
    expect(fetchModeratedChannels).toHaveBeenCalledTimes(2);
  });

  it('refuses a mod with no usable token', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValueOnce(null);
    expect(await modMembershipValid('s1', '200')).toBe(false);
    expect(fetchModeratedChannels).not.toHaveBeenCalled();
  });

  it('refuses a mod with no stream of their own, so no token', async () => {
    state.tables.streams = [{ id: 's1', twitch_user_id: '100' }];
    expect(await modMembershipValid('s1', '200')).toBe(false);
    expect(getValidAccessToken).not.toHaveBeenCalled();
  });

  it('refuses a channel with no Twitch account', async () => {
    state.tables.streams = [
      { id: 's1', twitch_user_id: null },
      { id: 'own-200', twitch_user_id: '200' },
    ];
    expect(await modMembershipValid('s1', '200')).toBe(false);
  });

  it.each([
    ['a Twitch server error', new TwitchApiError('down', 500)],
    ['a network failure', new Error('socket hang up')],
  ])('lets a mod through on %s, and asks again within a minute', async (_label, failure) => {
    vi.mocked(fetchModeratedChannels).mockRejectedValueOnce(failure);

    expect(await modMembershipValid('s1', '200')).toBe(true);
    expect(await modMembershipValid('s1', '200')).toBe(true);
    expect(fetchModeratedChannels).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31_000);
    await modMembershipValid('s1', '200');
    expect(fetchModeratedChannels).toHaveBeenCalledTimes(2);
  });

  it('makes one Twitch request for simultaneous calls', async () => {
    const answers = await Promise.all([
      modMembershipValid('s1', '200'),
      modMembershipValid('s1', '200'),
      modMembershipValid('s1', '200'),
    ]);
    expect(answers).toEqual([true, true, true]);
    expect(fetchModeratedChannels).toHaveBeenCalledTimes(1);
  });

  it('notices a removed row within seconds, without asking Twitch', async () => {
    await modMembershipValid('s1', '200');
    state.tables.moderators = [];

    // Inside the short cache the old answer stands.
    expect(await modMembershipValid('s1', '200')).toBe(true);

    vi.advanceTimersByTime(11_000);
    expect(await modMembershipValid('s1', '200')).toBe(false);
    expect(fetchModeratedChannels).toHaveBeenCalledTimes(1);
  });

  it('keeps one channel\'s answer from reaching another\'s', async () => {
    await modMembershipValid('s1', '200');
    expect(await modMembershipValid('s2', '200')).toBe(false);
  });

  it('throws rather than guessing when the database fails', async () => {
    state.rowError = { message: 'down' };
    await expect(modMembershipValid('s1', '200')).rejects.toThrow(/down/);
  });
});
