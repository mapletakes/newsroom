import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { archiveSlugFromUrl, createArchive, deleteArchive } from '@/lib/archive';
import { broadcastQueueChange } from '@/lib/realtime';
import type { ArchiveListItem } from '@/lib/archive-list';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Everything this stream has archived, for the /archives page: every
// submission with an archive link, joined to our own snapshot row where the
// link is one of ours (archive.today fallbacks have no row). Filtering and
// search happen client-side — a stream's archive is hundreds of rows, not
// millions — so this is capped rather than paginated.
const LIST_LIMIT = 2000;

export async function GET() {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('submissions')
    .select('id, title, url, publisher, kind, status, created_at, played_at, archive_url, archives(id, created_at, bytes)')
    .eq('stream_id', session.streamId)
    .not('archive_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = Omit<ArchiveListItem, 'source' | 'archived_at' | 'bytes'> & {
    archives: { id: string; created_at: string; bytes: number | null }[] | null;
  };
  const items: ArchiveListItem[] = ((data ?? []) as Row[]).map(({ archives, ...sub }) => {
    const slug = archiveSlugFromUrl(sub.archive_url);
    const snap = slug ? archives?.find((a) => a.id === slug) : undefined;
    return {
      ...sub,
      source: slug ? 'broadside' : 'archive.today',
      archived_at: snap?.created_at ?? null,
      bytes: snap?.bytes ?? null,
    };
  });
  return NextResponse.json({ items, truncated: items.length === LIST_LIMIT });
}

// Snapshot a submission's URL (lib/archive.ts) and store the link on it.
// Capture runs inline — usually a few seconds, bounded by the freezer's own
// deadline well inside maxDuration — so the button can show the result.
// `recapture: true` retries an item whose link is an archive.today fallback;
// our own snapshots are never silently replaced.
//
// Captures cost storage and bandwidth, so they only ever happen when a
// streamer or mod presses an archive button: every caller must send
// `manual: true`. Nothing archives automatically (approval used to), and the
// flag also turns away tabs still running that older auto-archiving code.
export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
  if (body.manual !== true) {
    return NextResponse.json({ error: 'archiving must be started from an archive button' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: sub } = await sb
    .from('submissions')
    .select('url, archive_url')
    .eq('id', id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: 'submission not found' }, { status: 404 });

  // Already archived — return what we have.
  const recapture = body.recapture === true && !!sub.archive_url && !archiveSlugFromUrl(sub.archive_url);
  if (sub.archive_url && !recapture) return NextResponse.json({ archive_url: sub.archive_url });

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

// Delete a submission's snapshot (takedowns, a capture that caught something
// it shouldn't) and clear the link from the submission and from any show
// notes it was copied into at play time, so nothing points at a dead /a/<id>.
export async function DELETE(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: sub } = await sb
    .from('submissions')
    .select('archive_url')
    .eq('id', id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: 'submission not found' }, { status: 404 });
  if (!sub.archive_url) return NextResponse.json({ ok: true });

  try {
    await deleteArchive(sb, sub.archive_url, session.streamId);
  } catch (err) {
    console.error('archive delete failed:', (err as Error).message);
    return NextResponse.json({ error: 'could not delete snapshot' }, { status: 500 });
  }

  await sb.from('submissions').update({ archive_url: null }).eq('id', id);
  await sb
    .from('show_notes')
    .update({ archive_url: null })
    .eq('stream_id', session.streamId)
    .eq('archive_url', sub.archive_url);
  broadcastQueueChange(session.streamId);
  return NextResponse.json({ ok: true });
}
