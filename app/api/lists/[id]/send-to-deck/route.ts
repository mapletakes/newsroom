import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';
import { broadcastQueueChange } from '@/lib/realtime';

// POST — copy list item(s) onto the live deck as approved submissions.
// Non-destructive: items stay on the list (it's a durable reference, not a
// staging queue) and can be sent again later, e.g. for a recurring segment.
//
// Two modes:
//   { itemIds?: string[], segmentId?: string | null } — the original mode:
//     send specific items (or the whole list, flat) into one existing deck
//     segment (or ungrouped).
//   { mode: 'rundown' } — send the whole shelf preserving its own block
//     structure: every list segment becomes a FRESH deck segment (never
//     reused/merged by name, so this can't silently land in an unrelated
//     live segment), items land inside in list order, and the shelf's
//     ungrouped bucket goes to the deck's ungrouped area. The shelf's own
//     structure is untouched — this is a copy, so the same rundown can be
//     sent again later.
// Duplicates already on the deck are skipped either way, same rule as every
// other add-to-deck path. Each item's curator note copies into the deck
// submission's `prep_note` (distinct from `mod_notes`, which is mod
// editorial/risk-flagging territory) — the deck's takeaway box seeds from it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data: list } = await sb
    .from('lists')
    .select('id')
    .eq('id', id)
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (!list) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  const { data: onDeckRows } = await sb
    .from('submissions')
    .select('normalized_url')
    .eq('stream_id', session.streamId)
    .eq('status', 'approved');
  const onDeck = new Set((onDeckRows || []).map((r) => r.normalized_url));

  const insertItem = async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    item: any,
    segId: string | null,
    position: number,
  ): Promise<boolean> => {
    if (onDeck.has(item.normalized_url)) return false;
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
      prep_note: item.note,
      position,
      submitter_login: session.twitchLogin,
    });
    return !error;
  };

  if (body.mode === 'rundown') {
    const { data: listSegments } = await sb
      .from('list_segments')
      .select('id, name, position')
      .eq('list_id', list.id)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });

    const { data: items } = await sb
      .from('list_items')
      .select('*')
      .eq('list_id', list.id)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    const allItems = items || [];

    // Where new deck segments get appended: after every existing one.
    const { data: maxSeg } = await sb
      .from('segments')
      .select('position')
      .eq('stream_id', session.streamId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: stream } = await sb
      .from('streams')
      .select('ungrouped_position')
      .eq('id', session.streamId)
      .maybeSingle();
    let nextSegPosition = Math.max(maxSeg?.position ?? 0, stream?.ungrouped_position ?? 0) + 1;

    let added = 0;
    let skipped = 0;
    let segmentsCreated = 0;

    for (const listSeg of listSegments || []) {
      const segItems = allItems.filter((it) => it.segment_id === listSeg.id);
      if (segItems.length === 0) continue; // don't create empty deck segments

      const { data: newSeg, error: segErr } = await sb
        .from('segments')
        .insert({ stream_id: session.streamId, name: listSeg.name, position: nextSegPosition++ })
        .select('id')
        .single();
      if (segErr || !newSeg) continue;
      segmentsCreated++;

      let pos = 1;
      for (const item of segItems) {
        if (await insertItem(item, newSeg.id, pos)) { added++; pos++; } else { skipped++; }
      }
    }

    // The shelf's own ungrouped bucket goes to the deck's ungrouped area,
    // appended after whatever's already there.
    const ungroupedItems = allItems.filter((it) => !it.segment_id);
    if (ungroupedItems.length > 0) {
      const { data: lastPos } = await sb
        .from('submissions')
        .select('position')
        .eq('stream_id', session.streamId)
        .eq('status', 'approved')
        .is('segment_id', null)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
      let pos = (lastPos?.position ?? 0) + 1;
      for (const item of ungroupedItems) {
        if (await insertItem(item, null, pos)) { added++; pos++; } else { skipped++; }
      }
    }

    if (added > 0) broadcastQueueChange(session.streamId);
    return NextResponse.json({ added, skipped, segmentsCreated });
  }

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
    if (await insertItem(item, segId, nextPos)) { added++; nextPos++; } else { skipped++; }
  }

  if (added > 0) broadcastQueueChange(session.streamId);
  return NextResponse.json({ added, skipped });
}
