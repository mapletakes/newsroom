import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';
import { renumberForCopy } from '@/lib/shelf-blocks';

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
    .select('id, name, stream_id, ungrouped_position')
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
    .insert({
      stream_id: session.streamId,
      name: source.name,
      position,
      // The ungrouped bucket's place among the segments is part of the layout.
      ungrouped_position: source.ungrouped_position ?? 0,
    })
    .select('id, name')
    .single();
  if (error || !newList) return NextResponse.json({ error: error?.message || 'import failed' }, { status: 500 });

  const { data: items } = await sb
    .from('list_items')
    .select('*')
    .eq('list_id', source.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  // Copy the shelf's segments first, remembering old id -> new id so each
  // item can be re-pointed at its copy. Fresh rows on purpose: the two shelves
  // are independent from here on, so they must not share segment rows.
  const { data: sourceSegments } = await sb
    .from('list_segments')
    .select('id, name, position')
    .eq('list_id', source.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  const segmentIdMap = new Map<string, string>();
  for (const seg of sourceSegments ?? []) {
    const { data: copy } = await sb
      .from('list_segments')
      .insert({ list_id: newList.id, name: seg.name, position: seg.position })
      .select('id')
      .single();
    if (copy) segmentIdMap.set(seg.id, copy.id);
  }

  if (items && items.length > 0) {
    // Only segments that actually copied count as known, so an item can never
    // be left pointing at the SOURCE shelf's segment.
    const copied = (sourceSegments ?? []).filter((s) => segmentIdMap.has(s.id));
    await sb.from('list_items').insert(
      renumberForCopy(items, copied).map((item) => ({
        list_id: newList.id,
        segment_id: item.segment_id ? segmentIdMap.get(item.segment_id)! : null,
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
        position: item.position,
      })),
    );
  }

  return NextResponse.json({ list: newList });
}
