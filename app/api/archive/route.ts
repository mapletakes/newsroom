import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { createArchive } from '@/lib/archive';
import { broadcastQueueChange } from '@/lib/realtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Snapshot a submission's URL (lib/archive.ts) and store the link on it.
// Capture runs inline — usually a few seconds, bounded by the freezer's own
// deadline well inside maxDuration — so the button can show the result.
export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: sub } = await sb
    .from('submissions')
    .select('url, archive_url')
    .eq('id', id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: 'submission not found' }, { status: 404 });

  // Already archived — return what we have.
  if (sub.archive_url) return NextResponse.json({ archive_url: sub.archive_url });

  const archiveUrl = await createArchive({
    sb,
    url: sub.url,
    submissionId: id,
    streamId: session.streamId,
    appUrl: process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin,
  });
  if (archiveUrl) {
    await sb.from('submissions').update({ archive_url: archiveUrl }).eq('id', id);
    broadcastQueueChange(session.streamId);
  }
  return NextResponse.json({ archive_url: archiveUrl });
}
