// What a signed cookie can't say: whether its holder is still allowed in.
// getSession() runs this on every authenticated request, so a block or a
// removal takes effect on the next request rather than when the cookie expires.

import { isBlocked } from './blocked-users';
import { modMembershipValid } from './mod-access';
import type { Session } from './session';

export async function sessionStillAllowed(session: Session): Promise<boolean> {
  if (await isBlocked(session.twitchUserId)) return false;
  // Streamers are their own channel's owner; only a mod's access is borrowed.
  if (session.role === 'mod') return modMembershipValid(session.streamId, session.twitchUserId);
  return true;
}
