import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { addToDeck } from '@/lib/deck-add';
import { canMemberCurate } from '@/lib/curate';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  // Streamer, or a mod the streamer authorized to curate.
  if (session.role !== 'streamer' && !(await canMemberCurate(session.streamId, session.twitchUserId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const url = String(body.url || '').trim();
  if (!url) return NextResponse.json({ error: 'missing url' }, { status: 400 });

  const result = await addToDeck(session.streamId, url, session.twitchLogin);
  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'failed to add' }, { status: 400 });
  }
  return NextResponse.json(result);
}
