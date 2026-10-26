import { NextRequest, NextResponse } from 'next/server';
import { acknowledgeShowNotes, readShowNotes } from '@/lib/show-notes';
import { getApprovedSession, getSession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const format = req.nextUrl.searchParams.get('format') || 'json';
  const isExport = format === 'markdown';
  const allHistory = isExport && req.nextUrl.searchParams.get('scope') === 'all';
  // A full-history download is a recovery/read operation, not consumption of
  // new notes. Keep it repeatable even if commit=1 was added to the URL.
  const commit = !allHistory && req.nextUrl.searchParams.get('commit') === '1';
  const session = await (isExport && commit ? getApprovedSession() : getSession());
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let data;
  try {
    data = await readShowNotes(session.streamId, isExport && !allHistory ? 'markdown' : 'history');
  } catch {
    return NextResponse.json({ error: 'could not load show notes' }, { status: 500 });
  }

  if (isExport) {
    const fmt = (iso: string) =>
      new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

    const lines: string[] = [];
    lines.push(`# Show Notes — ${session.displayName}`);
    lines.push('');
    lines.push(`_${data.length} items · ${allHistory ? 'all played items' : 'not previously exported'}_`);
    lines.push('');
    for (const n of data || []) {
      lines.push(`## [${n.title || n.url}](${n.url})`);
      lines.push('');
      const archive = n.archive_url;
      const meta = `*Played ${fmt(n.played_at)}*` + (archive ? ` · [Archived snapshot](${archive})` : '');
      lines.push(meta);
      lines.push('');
      if (n.summary) { lines.push(n.summary); lines.push(''); }
      if (n.takeaway) { lines.push(`> ${n.takeaway}`); lines.push(''); }
      lines.push('---'); lines.push('');
    }

    // Acknowledge only this snapshot's IDs. Later commits and replayed notes
    // stay pending even if their played_at is before the current wall clock.
    if (commit && data.length > 0) {
      try {
        await acknowledgeShowNotes(session.streamId, 'markdown', data.map((note) => note.id));
      } catch {
        return NextResponse.json({ error: 'could not save export receipts' }, { status: 500 });
      }
    }

    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="show-notes-${new Date().toISOString().slice(0, 10)}.md"`,
      },
    });
  }

  return NextResponse.json({ notes: data || [] });
}
