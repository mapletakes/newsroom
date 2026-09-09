import { NextResponse } from 'next/server';
import { getApprovedSession } from '@/lib/session';
import { buildPlayedMessages, getPendingPlayedNotes, postPlayedList } from '@/lib/discord';

// Streamer-only, same as /api/setup: the webhook posts to a channel the
// streamer configured, and the "since last post" boundary is channel-wide
// state, not something a mod should be able to advance on their behalf.

// Previews what the next Discord post would contain — the exact message
// text, chunked the same way postPlayedList would send it — without
// touching Discord or the discord_posted_at boundary. Works even without a
// webhook configured yet, so the Setup page can show "here's what would go
// out" before the streamer finishes pasting one in.
export async function GET() {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (session.role !== 'streamer') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const pending = await getPendingPlayedNotes(session.streamId);
  if (!pending) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const messages = buildPlayedMessages(pending.displayName, pending.notes);
  return NextResponse.json({ count: pending.notes.length, messages });
}

// Actually sends the pending played list to the configured webhook.
export async function POST() {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (session.role !== 'streamer') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const result = await postPlayedList(session.streamId);
  if (!result.ok) {
    const status = result.error === 'no-webhook' || result.error === 'nothing-to-post' ? 400 : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, count: result.count });
}
