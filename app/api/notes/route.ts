import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const format = req.nextUrl.searchParams.get('format') || 'json';
  const commit = req.nextUrl.searchParams.get('commit') === '1';
  const isExport = format === 'markdown';
  const sb = supabaseAdmin();

  // For the markdown export, only include notes since the last export boundary,
  // so a broadcast that runs past midnight is exported as one continuous set.
  let lastExport: string | null = null;
  if (isExport) {
    const { data: streamRow, error: srErr } = await sb
      .from('streams')
      .select('notes_exported_at')
      .eq('id', session.streamId)
      .maybeSingle();
    if (!srErr && streamRow?.notes_exported_at) lastExport = streamRow.notes_exported_at;
  }

  let q = sb
    .from('show_notes')
    .select('*')
    .eq('stream_id', session.streamId)
    .order('played_at', { ascending: true });
  if (isExport && lastExport) q = q.gt('played_at', lastExport);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (isExport) {
    const fmt = (iso: string) =>
      new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

    const lines: string[] = [];
    lines.push(`# Show Notes — ${session.displayName}`);
    lines.push('');
    const range = lastExport ? `since ${fmt(lastExport)}` : 'all items';
    lines.push(`_${data?.length || 0} items · ${range}_`);
    lines.push('');
    for (const n of data || []) {
      lines.push(`## [${n.title || n.url}](${n.url})`);
      lines.push('');
      lines.push(`*Played ${fmt(n.played_at)}*`);
      lines.push('');
      if (n.summary) { lines.push(n.summary); lines.push(''); }
      if (n.takeaway) { lines.push(`> ${n.takeaway}`); lines.push(''); }
      lines.push('---'); lines.push('');
    }

    // Advance the export boundary so the next export starts from here.
    // Only when explicitly committing and there was something to export.
    if (commit && (data?.length || 0) > 0) {
      await sb
        .from('streams')
        .update({ notes_exported_at: new Date().toISOString() })
        .eq('id', session.streamId);
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
