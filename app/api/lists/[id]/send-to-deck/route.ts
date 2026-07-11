import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';
import { broadcastQueueChange } from '@/lib/realtime';

// POST — copy list item(s) onto the live deck as approved submissions.
// Non-destructive: items stay on the list (it's a durable reference, not a
// staging queue) and can be sent again later, e.g. for a recurring segment.
// Body: { itemIds?: string[], segmentId?: string | null } — omitting itemIds
// sends the whole list. Duplicates already on the deck are skipped, same
// rule as every other add-to-deck path.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data: list } = await sb
    .from('lists')
    .select('id')
    .eq('id', params.id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!list) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const itemIds: string[] | null = Array.isArray(body.itemIds) ? body.itemIds.map(String) : null;

  let segId: string | null = null;
  if (body.segmentId) {
    const { data: seg } = await sb
      .from('segments')
      .select('id')
      .eq('id', String(body.segmentId))
      .eq('stream_id', session.streamId)
      .maybeSingle();
    segId = seg?.id ?? null;
  }

  let itemsQuery = sb.from('list_items').select('*').eq('list_id', list.id);
  if (itemIds) itemsQuery = itemsQuery.in('id', itemIds);
  const { data: items } = await itemsQuery;
  if (!items || items.length === 0) return NextResponse.json({ added: 0, skipped: 0 });

  const { data: onDeckRows } = await sb
    .from('submissions')
    .select('normalized_url')
    .eq('stream_id', session.streamId)
    .eq('status', 'approved');
  const onDeck = new Set((onDeckRows || []).map((r) => r.normalized_url));

  let posQuery = sb
    .from('submissions')
    .select('position')
    .eq('stream_id', session.streamId)
    .eq('status', 'approved');
  posQuery = segId ? posQuery.eq('segment_id', segId) : posQuery.is('segment_id', null);
  const { data: lastPos } = await posQuery.order('position', { ascending: false }).limit(1).maybeSingle();
  let nextPos = (lastPos?.position ?? 0) + 1;

  let added = 0;
  let skipped = 0;
  for (const item of items) {
    if (onDeck.has(item.normalized_url)) { skipped++; continue; }
    onDeck.add(item.normalized_url);
    const { error } = await sb.from('submissions').insert({
      stream_id: session.streamId,
      url: item.url,
      normalized_url: item.normalized_url,
      kind: item.kind,
      status: 'approved',
      approved_at: new Date().toISOString(),
      segment_id: segId,
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
      mod_notes: item.note,
      position: nextPos++,
      submitter_login: session.twitchLogin,
    });
    if (!error) added++;
  }

  if (added > 0) broadcastQueueChange(session.streamId);
  return NextResponse.json({ added, skipped });
}
