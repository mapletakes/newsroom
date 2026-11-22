import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  ids: [] as string[],
  error: null as { message: string } | null,
  throwOnConnect: false,
  reads: 0,
}));

vi.mock('./supabase', () => ({
  supabaseAdmin: () => {
    if (db.throwOnConnect) throw new Error('Missing Supabase env vars');
    return {
      from: () => ({
        select: async () => {
          db.reads += 1;
          return { data: db.ids.map((id) => ({ twitch_user_id: id })), error: db.error };
        },
      }),
    };
  },
}));
vi.mock('./twitch-eventsub', () => ({ getAppAccessToken: vi.fn(async () => 'app-token') }));

import {
  blockUser,
  clearBlockedCache,
  isBlocked,
  listBlockedUsers,
  lookupTwitchUserByLogin,
  unblockUser,
} from './blocked-users';

beforeEach(() => {
  clearBlockedCache();
  db.ids = [];
  db.error = null;
  db.throwOnConnect = false;
  db.reads = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('isBlocked', () => {
  it('knows who is on the list', async () => {
    db.ids = ['5'];
    expect(await isBlocked('5')).toBe(true);
    expect(await isBlocked('6')).toBe(false);
  });

  it('has nothing to look up for an account with no Twitch id', async () => {
    expect(await isBlocked(undefined)).toBe(false);
    expect(db.reads).toBe(0);
  });

  it('reads the list once for a burst of requests, then again after ten seconds', async () => {
    db.ids = ['5'];
    await isBlocked('5');
    await isBlocked('6');
    await isBlocked('5');
    expect(db.reads).toBe(1);

    vi.advanceTimersByTime(11_000);
    await isBlocked('5');
    expect(db.reads).toBe(2);
  });

  it('picks up a new block once the cache lapses', async () => {
    expect(await isBlocked('5')).toBe(false);
    db.ids = ['5'];
    expect(await isBlocked('5')).toBe(false);

    vi.advanceTimersByTime(11_000);
    expect(await isBlocked('5')).toBe(true);
  });

  it('can skip the cache, for the moment of signing in', async () => {
    expect(await isBlocked('5')).toBe(false);
    db.ids = ['5'];
    expect(await isBlocked('5', { fresh: true })).toBe(true);
  });

  it('keeps the last list it had when the database fails, rather than locking everyone out', async () => {
    db.ids = ['5'];
    await isBlocked('5');
    vi.advanceTimersByTime(11_000);
    db.error = { message: 'down' };

    expect(await isBlocked('5')).toBe(true);
    expect(await isBlocked('6')).toBe(false);
  });

  it('blocks nobody if the list has never been readable, for instance before it is migrated', async () => {
    db.error = { message: 'relation "blocked_users" does not exist' };
    expect(await isBlocked('5')).toBe(false);
  });

  it('blocks nobody if the database cannot even be reached', async () => {
    db.throwOnConnect = true;
    expect(await isBlocked('5')).toBe(false);
  });
});

type Call = [string, string, ...unknown[]];

function fakeSb(opts: { upsertError?: { message: string }; deleteError?: { message: string }; listError?: { message: string } } = {}) {
  const calls: Call[] = [];
  const sb = {
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>, options: unknown) => {
        calls.push(['upsert', table, row, options]);
        return {
          select: () => ({
            single: async () =>
              opts.upsertError
                ? { data: null, error: opts.upsertError }
                : { data: { ...row, created_at: '2026-11-21T12:00:00Z' }, error: null },
          }),
        };
      },
      delete: () => ({
        eq: async (column: string, value: unknown) => {
          calls.push(['delete', table, column, value]);
          return { error: opts.deleteError ?? null };
        },
      }),
      select: () => ({
        order: async () => ({ data: opts.listError ? null : [{ twitch_user_id: '5' }], error: opts.listError ?? null }),
      }),
    }),
  };
  return { sb: sb as never, calls };
}

describe('blockUser', () => {
  it('records the block by Twitch id and removes them as a moderator everywhere', async () => {
    const { sb, calls } = fakeSb();

    const result = await blockUser(sb, { id: '5', login: 'badguy' }, 'mike', 'harassment');

    expect(result).toMatchObject({ ok: true, user: { twitch_user_id: '5', twitch_login: 'badguy', reason: 'harassment' } });
    expect(calls).toContainEqual([
      'upsert',
      'blocked_users',
      { twitch_user_id: '5', twitch_login: 'badguy', reason: 'harassment', blocked_by_login: 'mike' },
      { onConflict: 'twitch_user_id' },
    ]);
    expect(calls).toContainEqual(['delete', 'moderators', 'twitch_user_id', '5']);
  });

  it('takes effect on this server at once, not after the cache lapses', async () => {
    expect(await isBlocked('5')).toBe(false);
    db.ids = ['5'];

    await blockUser(fakeSb().sb, { id: '5', login: 'badguy' }, 'mike', null);

    expect(await isBlocked('5')).toBe(true);
  });

  it('reports a failed save, and does not go on to touch the moderator rows', async () => {
    const { sb, calls } = fakeSb({ upsertError: { message: 'nope' } });
    expect(await blockUser(sb, { id: '5', login: 'badguy' }, 'mike', null)).toEqual({ ok: false, error: 'nope' });
    expect(calls.some(([op, table]) => op === 'delete' && table === 'moderators')).toBe(false);
  });

  it('still counts as blocked when only the moderator cleanup fails', async () => {
    const { sb } = fakeSb({ deleteError: { message: 'nope' } });
    expect((await blockUser(sb, { id: '5', login: 'badguy' }, 'mike', null)).ok).toBe(true);
  });
});

describe('unblockUser', () => {
  it('lifts the block and takes effect on this server at once', async () => {
    db.ids = ['5'];
    expect(await isBlocked('5')).toBe(true);
    db.ids = [];
    const { sb, calls } = fakeSb();

    expect(await unblockUser(sb, '5')).toEqual({ ok: true });

    expect(calls).toContainEqual(['delete', 'blocked_users', 'twitch_user_id', '5']);
    expect(await isBlocked('5')).toBe(false);
  });

  it('reports a failure', async () => {
    const { sb } = fakeSb({ deleteError: { message: 'nope' } });
    expect(await unblockUser(sb, '5')).toEqual({ ok: false, error: 'nope' });
  });
});

describe('listBlockedUsers', () => {
  it('lists them', async () => {
    expect(await listBlockedUsers(fakeSb().sb)).toEqual([{ twitch_user_id: '5' }]);
  });

  it('is empty, not a crash, when the list cannot be read', async () => {
    expect(await listBlockedUsers(fakeSb({ listError: { message: 'nope' } }).sb)).toEqual([]);
  });
});

describe('lookupTwitchUserByLogin', () => {
  const answer = (body: unknown, status = 200) =>
    vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

  it('finds a user by login, sending only the encoded login to Twitch', async () => {
    vi.stubEnv('NEXT_PUBLIC_TWITCH_CLIENT_ID', 'client');
    const fetchMock = answer({ data: [{ id: '5', login: 'badguy', display_name: 'BadGuy' }] });
    vi.stubGlobal('fetch', fetchMock);

    expect(await lookupTwitchUserByLogin('badguy')).toEqual({ id: '5', login: 'badguy', display_name: 'BadGuy' });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.twitch.tv/helix/users?login=badguy');
  });

  it('says so when there is no such user', async () => {
    vi.stubGlobal('fetch', answer({ data: [] }));
    expect(await lookupTwitchUserByLogin('nobody')).toBeNull();
  });

  it.each([
    ['Twitch refusing', () => answer({}, 500)],
    ['the request failing', () => vi.fn(async (_url: string) => Promise.reject(new Error('offline')))],
  ])('reports an error on %s, not "no such user"', async (_label, make) => {
    vi.stubGlobal('fetch', make());
    expect(await lookupTwitchUserByLogin('badguy')).toBe('error');
  });
});
