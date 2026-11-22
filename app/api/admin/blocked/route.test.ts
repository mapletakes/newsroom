import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ session: null as Record<string, unknown> | null }));

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(async () => state.session),
  sessionLogin: (s: { twitchLogin?: string; displayName: string }) => s.twitchLogin || s.displayName,
}));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: () => ({ marker: 'sb' }) }));
vi.mock('@/lib/audit', () => ({ logAdminAction: vi.fn(async () => {}) }));
vi.mock('@/lib/blocked-users', () => ({
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
  listBlockedUsers: vi.fn(async () => []),
  lookupTwitchUserByLogin: vi.fn(),
}));

import { logAdminAction } from '@/lib/audit';
import { blockUser, listBlockedUsers, lookupTwitchUserByLogin, unblockUser } from '@/lib/blocked-users';
import { DELETE, GET, POST } from './route';

const admin = { twitchUserId: '1', twitchLogin: 'mike', displayName: 'Mike', role: 'streamer' };
const someone = { twitchUserId: '50', twitchLogin: 'other', displayName: 'Other', role: 'streamer' };
const BLOCKED = {
  twitch_user_id: '5',
  twitch_login: 'badguy',
  reason: null,
  blocked_by_login: 'mike',
  created_at: '2026-11-21T12:00:00Z',
};

const call = (method: 'POST' | 'DELETE', body: unknown) =>
  new NextRequest('http://localhost/api/admin/blocked', { method, body: JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv('ADMIN_TWITCH_IDS', '1,2');
  state.session = admin;
  vi.mocked(lookupTwitchUserByLogin).mockResolvedValue({ id: '5', login: 'badguy', display_name: 'BadGuy' });
  vi.mocked(blockUser).mockResolvedValue({ ok: true, user: BLOCKED });
  vi.mocked(unblockUser).mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('admin only', () => {
  it.each([
    ['nobody signed in', null],
    ['an ordinary streamer', someone],
  ])('refuses %s', async (_label, session) => {
    state.session = session;
    expect((await GET()).status).toBe(403);
    expect((await POST(call('POST', { login: 'badguy' }))).status).toBe(403);
    expect((await DELETE(call('DELETE', { twitchUserId: '5' }))).status).toBe(403);
    expect(blockUser).not.toHaveBeenCalled();
    expect(unblockUser).not.toHaveBeenCalled();
    expect(lookupTwitchUserByLogin).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/blocked', () => {
  it('lists the blocked users', async () => {
    vi.mocked(listBlockedUsers).mockResolvedValueOnce([BLOCKED]);
    expect(await (await GET()).json()).toEqual({ users: [BLOCKED] });
  });
});

describe('POST /api/admin/blocked', () => {
  it.each([[''], ['bad name!'], ['a'.repeat(26)], [undefined]])('rejects the login %j without asking Twitch', async (login) => {
    expect((await POST(call('POST', { login }))).status).toBe(400);
    expect(lookupTwitchUserByLogin).not.toHaveBeenCalled();
  });

  it('accepts a login written with an @ or capitals', async () => {
    await POST(call('POST', { login: ' @BadGuy ' }));
    expect(lookupTwitchUserByLogin).toHaveBeenCalledWith('badguy');
  });

  it('blocks the person Twitch says that login is, and records who did it', async () => {
    const res = await POST(call('POST', { login: 'badguy', reason: '  harassment  ' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, user: BLOCKED });
    expect(blockUser).toHaveBeenCalledWith({ marker: 'sb' }, { id: '5', login: 'badguy', display_name: 'BadGuy' }, 'mike', 'harassment');
    expect(logAdminAction).toHaveBeenCalledWith(
      { marker: 'sb' },
      admin,
      'block_user',
      null,
      { login: 'badguy', twitchUserId: '5', reason: 'harassment' },
    );
  });

  it('stores no reason rather than an empty or oversized one', async () => {
    await POST(call('POST', { login: 'badguy', reason: '   ' }));
    expect(vi.mocked(blockUser).mock.calls[0][3]).toBeNull();

    await POST(call('POST', { login: 'badguy', reason: 'x'.repeat(500) }));
    expect(vi.mocked(blockUser).mock.calls[1][3]).toHaveLength(200);
  });

  it('says so when there is no such Twitch user', async () => {
    vi.mocked(lookupTwitchUserByLogin).mockResolvedValueOnce(null);
    expect((await POST(call('POST', { login: 'nobody' }))).status).toBe(404);
    expect(blockUser).not.toHaveBeenCalled();
  });

  it('says so when Twitch cannot be reached, rather than claiming there is no such user', async () => {
    vi.mocked(lookupTwitchUserByLogin).mockResolvedValueOnce('error');
    expect((await POST(call('POST', { login: 'badguy' }))).status).toBe(502);
    expect(blockUser).not.toHaveBeenCalled();
  });

  it('will not block an admin, who would then be unable to lift it', async () => {
    vi.mocked(lookupTwitchUserByLogin).mockResolvedValueOnce({ id: '2', login: 'otheradmin', display_name: 'OtherAdmin' });
    const res = await POST(call('POST', { login: 'otheradmin' }));
    expect(res.status).toBe(400);
    expect(blockUser).not.toHaveBeenCalled();
  });

  it('will not block the admin making the request', async () => {
    vi.mocked(lookupTwitchUserByLogin).mockResolvedValueOnce({ id: '1', login: 'mike', display_name: 'Mike' });
    expect((await POST(call('POST', { login: 'mike' }))).status).toBe(400);
    expect(blockUser).not.toHaveBeenCalled();
  });

  it('reports a failed save and logs nothing', async () => {
    vi.mocked(blockUser).mockResolvedValueOnce({ ok: false, error: 'down' });
    expect((await POST(call('POST', { login: 'badguy' }))).status).toBe(500);
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/blocked', () => {
  it.each([[{}], [{ twitchUserId: 'abc' }], [{ twitchUserId: 5 }], [{ twitchUserId: '5; drop' }]])(
    'rejects an invalid id %j',
    async (body) => {
      expect((await DELETE(call('DELETE', body))).status).toBe(400);
      expect(unblockUser).not.toHaveBeenCalled();
    },
  );

  it('unblocks and records it', async () => {
    const res = await DELETE(call('DELETE', { twitchUserId: '5' }));
    expect(res.status).toBe(200);
    expect(unblockUser).toHaveBeenCalledWith({ marker: 'sb' }, '5');
    expect(logAdminAction).toHaveBeenCalledWith({ marker: 'sb' }, admin, 'unblock_user', null, { twitchUserId: '5' });
  });

  it('reports a failure', async () => {
    vi.mocked(unblockUser).mockResolvedValueOnce({ ok: false, error: 'down' });
    expect((await DELETE(call('DELETE', { twitchUserId: '5' }))).status).toBe(500);
  });
});
