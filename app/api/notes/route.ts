import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const format = req.nextUrl.searchParams.get('format') || 'json';
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('show_notes')
    .select('*')
    .eq('stream_id', session.streamId)
    .order('played_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (format === 'markdown') {
    const lines: string[] = [];
    lines.push(`# Show Notes — ${session.displayName}`);
    lines.push('');
    lines.push(`_${(data?.length || 0)} items_`);
    lines.push('');
    for (const n of data || []) {
      const t = new Date(n.played_at).toLocaleString();
      lines.push(`## [${n.title || n.url}](${n.url})`);
      lines.push('');
      lines.push(`*Played ${t}*`);
      lines.push('');
      if (n.summary) { lines.push(n.summary); lines.push(''); }
      if (n.takeaway) { lines.push(`> ${n.takeaway}`); lines.push(''); }
      lines.push('---'); lines.push('');
    }
    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="show-notes-${new Date().toISOString().slice(0,10)}.md"`,
      },
    });
  }

  return NextResponse.json({ notes: data || [] });
}
