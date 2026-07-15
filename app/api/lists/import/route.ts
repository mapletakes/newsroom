import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';

// POST { token } — import a shared shelf as a new, independent one on the
// importer's own stream. A copy, not a live subscription: the two shelves
// diverge immediately and editing one never touches the other. That trade
// avoids every hard problem a live sync would introduce (what happens when
// the source is edited, deleted, or unshared out from under an importer).
export async function POST(req: Request) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return NextResponse.json({ error: 'missing token' }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: source } = await sb
    .from('lists')
    .select('id, name, stream_id')
    .eq('share_token', token)
    .maybeSingle();
  if (!source) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: sourceStream } = await sb
    .from('streams')
    .select('twitch_login')
    .eq('id', source.stream_id)
    .maybeSingle();
  const attribution = sourceStream?.twitch_login ? `via @${sourceStream.twitch_login}` : 'via a shared shelf';

  const { data: first } = await sb
    .from('lists')
    .select('position')
    .eq('stream_id', session.streamId)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  const position = (first?.position ?? 0) - 1;

  const { data: newList, error } = await sb
    .from('lists')
    .insert({ stream_id: session.streamId, name: source.name, position })
    .select('id, name')
    .single();
  if (error || !newList) return NextResponse.json({ error: error?.message || 'import failed' }, { status: 500 });

  const { data: items } = await sb
    .from('list_items')
    .select('*')
    .eq('list_id', source.id)
    .order('position', { ascending: true });

  if (items && items.length > 0) {
    await sb.from('list_items').insert(
      items.map((item, i) => ({
        list_id: newList.id,
        url: item.url,
        normalized_url: item.normalized_url,
        kind: item.kind,
        title: item.title,
        description: item.description,
        thumbnail_url: item.thumbnail_url,
        publisher: item.publisher,
        author: item.author,
        duration_seconds: item.duration_seconds,
        published_at: item.published_at,
        summary: item.summary,
        credibility_tag: item.credibility_tag,
        topics: item.topics,
        dmca_risk: item.dmca_risk,
        content_warning: item.content_warning,
        note: item.note,
        added_by: attribution,
        position: i + 1,
      })),
    );
  }

  return NextResponse.json({ list: newList });
}
