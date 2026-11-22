// getSession() must not trust a validly signed cookie on its own: the cookie
// outlives the person's right to use it.
import { afterEach, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (jar.value === undefined ? undefined : { value: jar.value }),
    delete: vi.fn(),
  }),
}));
vi.mock('./session-guard', () => ({ sessionStillAllowed: vi.fn(async () => true) }));

import { buildSessionCookie, getSession, type Session } from './session';
import { sessionStillAllowed } from './session-guard';

const SESSION: Session = {
  streamId: 's1',
  accountId: '200',
  twitchUserId: '200',
  twitchLogin: 'themod',
  displayName: 'TheMod',
  role: 'mod',
};

afterEach(() => {
  jar.value = undefined;
  vi.clearAllMocks();
});

describe('getSession', () => {
  it('has no session without a cookie, and checks nothing', async () => {
    expect(await getSession()).toBeNull();
    expect(sessionStillAllowed).not.toHaveBeenCalled();
  });

  it('rejects a forged cookie before checking anything else', async () => {
    jar.value = `${buildSessionCookie(SESSION).value}x`;
    expect(await getSession()).toBeNull();
    expect(sessionStillAllowed).not.toHaveBeenCalled();
  });

  it('returns the session when the cookie is valid and the person is still allowed', async () => {
    jar.value = buildSessionCookie(SESSION).value;
    expect(await getSession()).toEqual(SESSION);
    expect(sessionStillAllowed).toHaveBeenCalledWith(SESSION);
  });

  it('returns nothing for a valid cookie whose holder has been removed or blocked', async () => {
    jar.value = buildSessionCookie(SESSION).value;
    vi.mocked(sessionStillAllowed).mockResolvedValueOnce(false);
    expect(await getSession()).toBeNull();
  });
});
