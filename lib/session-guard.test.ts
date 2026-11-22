import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./blocked-users', () => ({ isBlocked: vi.fn(async () => false) }));
vi.mock('./mod-access', () => ({ modMembershipValid: vi.fn(async () => true) }));

import { isBlocked } from './blocked-users';
import { modMembershipValid } from './mod-access';
import { sessionStillAllowed } from './session-guard';
import type { Session } from './session';

const streamer: Session = {
  streamId: 's1',
  accountId: '100',
  twitchUserId: '100',
  twitchLogin: 'streamer',
  displayName: 'Streamer',
  role: 'streamer',
};
const mod: Session = { ...streamer, accountId: '200', twitchUserId: '200', twitchLogin: 'themod', role: 'mod' };

afterEach(() => vi.clearAllMocks());

describe('sessionStillAllowed', () => {
  it('admits a streamer without checking moderator status', async () => {
    expect(await sessionStillAllowed(streamer)).toBe(true);
    expect(modMembershipValid).not.toHaveBeenCalled();
  });

  it('admits an account with no Twitch identity', async () => {
    const email: Session = { streamId: 's1', accountId: 'auth-1', displayName: 'Em', role: 'streamer' };
    expect(await sessionStillAllowed(email)).toBe(true);
    expect(isBlocked).toHaveBeenCalledWith(undefined);
  });

  it('refuses a blocked person, whatever their role', async () => {
    vi.mocked(isBlocked).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    expect(await sessionStillAllowed(streamer)).toBe(false);
    expect(await sessionStillAllowed(mod)).toBe(false);
    // No point asking whether they moderate a channel they're barred from.
    expect(modMembershipValid).not.toHaveBeenCalled();
  });

  it('admits a mod who still moderates the channel', async () => {
    expect(await sessionStillAllowed(mod)).toBe(true);
    expect(modMembershipValid).toHaveBeenCalledWith('s1', '200');
  });

  it('refuses a mod who no longer does', async () => {
    vi.mocked(modMembershipValid).mockResolvedValueOnce(false);
    expect(await sessionStillAllowed(mod)).toBe(false);
  });
});
