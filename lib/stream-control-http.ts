// Guards and response helpers shared by the stream-control API routes.

import { NextResponse } from 'next/server';
import { getApprovedSession, type Session } from './session';
import { getStreamControlAccess, type StreamControlAccess } from './stream-control';

// Never cached: every answer depends on who is asking.
export const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

type Guarded = { ok: true; session: Session; access: StreamControlAccess } | { ok: false; response: NextResponse };

/** Signed in, channel approved, module on. */
export async function requireStreamControl(): Promise<Guarded> {
  const session = await getApprovedSession();
  if (!session) return { ok: false, response: reply({ error: 'unauthenticated' }, 401) };
  const access = await getStreamControlAccess(session);
  if (!access.enabled) return { ok: false, response: reply({ error: 'disabled' }, 403) };
  return { ok: true, session, access };
}

/** As requireStreamControl, and the caller is the streamer: only they run the
 *  relay, since it acts with their Streamlabs token on their PC. */
export async function requireRelay(): Promise<Guarded> {
  const guard = await requireStreamControl();
  if (guard.ok && !guard.access.canRunRelay) return { ok: false, response: reply({ error: 'forbidden' }, 403) };
  return guard;
}
