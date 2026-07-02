import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { isAdmin } from '@/lib/admin';
import { pruneStaleSubscriptions } from '@/lib/twitch-eventsub';

export const dynamic = 'force-dynamic';

// Delete EventSub subscriptions pointing at an old callback (e.g. leftovers
// from a domain change) so each chat message is delivered only once.
export async function POST() {
  const session = await getSession();
  if (!session || !isAdmin(session.twitchUserId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    const result = await pruneStaleSubscriptions();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
