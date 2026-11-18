import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  stream: null as Record<string, unknown> | null,
  ownStream: { id: 'mod-own-stream' } as { id: string } | null,
}));

vi.mock('./session', () => ({ getApprovedSession: vi.fn(async () => state.session) }));
vi.mock('./announce', () => ({ getValidAccessToken: vi.fn(async () => 'mod-token') }));
vi.mock('./twitch-oauth', async (orig) => ({
  ...(await orig<typeof import('./twitch-oauth')>()),
  fetchModeratedChannels: vi.fn(async () => [{ broadcaster_id: '100' }]),
}));
vi.mock('./supabase', () => ({
  supabaseAdmin: () => ({
    from: () => {
      let column = '';
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (name: string) => {
        column = name;
        return chain;
      };
      chain.maybeSingle = async () => ({ data: column === 'id' ? state.stream : state.ownStream });
      return chain;
    },
  }),
}));

import { getValidAccessToken } from './announce';
import { clearModCheckCache, getSuspiciousLogAccess } from './suspicious-log-access';
import { TwitchApiError, fetchModeratedChannels } from './twitch-oauth';

const streamer = { streamId: 's1', role: 'streamer', twitchUserId: '100' };
const mod = { streamId: 's1', role: 'mod', twitchUserId: '200' };

beforeEach(() => {
  clearModCheckCache();
  state.session = mod;
  state.ownStream = { id: 'mod-own-stream' };
  state.stream = {
    twitch_user_id: '100',
    suspicious_log_enabled: true,
    suspicious_log_status: 'active',
    suspicious_log_status_at: null,
  };
});

afterEach(() => vi.clearAllMocks());

describe('getSuspiciousLogAccess', () => {
  it('refuses anyone without an approved session', async () => {
    state.session = null;
    expect(await getSuspiciousLogAccess()).toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it('admits the channel owner without asking Twitch', async () => {
    state.session = streamer;
    expect(await getSuspiciousLogAccess()).toMatchObject({ ok: true, role: 'streamer', logStatus: 'active' });
    expect(fetchModeratedChannels).not.toHaveBeenCalled();
  });

  it('refuses a streamer session for someone else\'s channel', async () => {
    state.session = { ...streamer, twitchUserId: '999' };
    expect(await getSuspiciousLogAccess()).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('keeps the streamer\'s access after the module is turned off', async () => {
    state.session = streamer;
    state.stream = { ...state.stream, suspicious_log_enabled: false };
    expect(await getSuspiciousLogAccess()).toMatchObject({ ok: true, logEnabled: false });
  });

  it('refuses mods while the module is off', async () => {
    state.stream = { ...state.stream, suspicious_log_enabled: false };
    expect(await getSuspiciousLogAccess()).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('admits a current mod confirmed by Twitch', async () => {
    expect(await getSuspiciousLogAccess()).toMatchObject({ ok: true, role: 'mod' });
    expect(fetchModeratedChannels).toHaveBeenCalledWith('mod-token', '200', { strict: true });
  });

  it('refuses someone Twitch no longer lists as a mod', async () => {
    vi.mocked(fetchModeratedChannels).mockResolvedValueOnce([]);
    expect(await getSuspiciousLogAccess()).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('remembers a confirmation briefly, then asks Twitch again', async () => {
    vi.useFakeTimers();
    try {
      await getSuspiciousLogAccess();
      await getSuspiciousLogAccess();
      expect(fetchModeratedChannels).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      vi.mocked(fetchModeratedChannels).mockResolvedValueOnce([]);
      expect(await getSuspiciousLogAccess()).toEqual({ ok: false, reason: 'forbidden' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('never remembers a refusal', async () => {
    vi.mocked(fetchModeratedChannels).mockResolvedValueOnce([]);
    await getSuspiciousLogAccess();
    expect(await getSuspiciousLogAccess()).toMatchObject({ ok: true });
  });

  it('asks a mod with no usable token to reconnect', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValueOnce(null);
    expect(await getSuspiciousLogAccess()).toEqual({ ok: false, reason: 'reconnect' });
  });

  it('asks a mod to reconnect when Twitch rejects their token', async () => {
    vi.mocked(fetchModeratedChannels).mockRejectedValueOnce(new TwitchApiError('no', 401));
    expect(await getSuspiciousLogAccess()).toEqual({ ok: false, reason: 'reconnect' });
  });

  it('denies access when Twitch can\'t be reached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fetchModeratedChannels).mockRejectedValueOnce(new TwitchApiError('down', 500));
    expect(await getSuspiciousLogAccess()).toEqual({ ok: false, reason: 'twitch' });
  });
});
