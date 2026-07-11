import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';
import { detectKind, normalizeUrl } from '@/lib/url';
import { runListItemExtraction } from '@/lib/list-extract';

export const dynamic = 'force-dynamic';

// POST — add item(s) to a clip file. Body is one of:
//   { submissionId }        — copy one submission's metadata in
//   { submissionIds: [] }   — copy several at once (the deck's multi-select "Save to…")
//   { url }                 — direct add by URL, runs its own extraction
// Already-present items (matched by normalized_url within this list) are
// silently skipped rather than duplicated.
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
  const submissionIds: string[] = Array.isArray(body.submissionIds)
    ? body.submissionIds.map(String)
    : body.submissionId
      ? [String(body.submissionId)]
      : [];
  const url: string = typeof body.url === 'string' ? body.url.trim() : '';

  if (submissionIds.length === 0 && !url) {
    return NextResponse.json({ error: 'missing submissionId(s) or url' }, { status: 400 });
  }

  const { data: existing } = await sb.from('list_items').select('normalized_url').eq('list_id', list.id);
  const already = new Set((existing || []).map((r) => r.normalized_url));

  const { data: last } = await sb
    .from('list_items')
    .select('position')
    .eq('list_id', list.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextPos = (last?.position ?? 0) + 1;

  let added = 0;
  let skipped = 0;
  let firstAddedId: string | null = null;

  if (submissionIds.length > 0) {
    const { data: subs } = await sb
      .from('submissions')
      .select('*')
      .eq('stream_id', session.streamId)
      .in('id', submissionIds);

    for (const sub of subs || []) {
      if (already.has(sub.normalized_url)) { skipped++; continue; }
      already.add(sub.normalized_url);
      const { data: inserted } = await sb
        .from('list_items')
        .insert({
          list_id: list.id,
          url: sub.url,
          normalized_url: sub.normalized_url,
          kind: sub.kind,
          title: sub.title,
          description: sub.description,
          thumbnail_url: sub.thumbnail_url,
          publisher: sub.publisher,
          author: sub.author,
          duration_seconds: sub.duration_seconds,
          published_at: sub.published_at,
          summary: sub.summary,
          credibility_tag: sub.credibility_tag,
          topics: sub.topics,
          dmca_risk: sub.dmca_risk,
          content_warning: sub.content_warning,
          note: sub.mod_notes || null,
          added_by: session.twitchLogin,
          position: nextPos++,
        })
        .select('id')
        .single();
      if (inserted) { added++; firstAddedId = firstAddedId || inserted.id; }
    }
  } else {
    const normalized = normalizeUrl(url);
    if (already.has(normalized)) {
      return NextResponse.json({ added: 0, skipped: 1 });
    }
    const kind = detectKind(url);
    const { data: inserted, error } = await sb
      .from('list_items')
      .insert({
        list_id: list.id,
        url,
        normalized_url: normalized,
        kind,
        added_by: session.twitchLogin,
        position: nextPos,
      })
      .select('id')
      .single();
    if (error || !inserted) return NextResponse.json({ error: error?.message || 'insert failed' }, { status: 500 });
    added = 1;
    firstAddedId = inserted.id;
    await runListItemExtraction(inserted.id, session.streamId);
  }

  await sb.from('lists').update({ updated_at: new Date().toISOString() }).eq('id', list.id);

  let item = null;
  if (firstAddedId) {
    const { data } = await sb.from('list_items').select('*').eq('id', firstAddedId).maybeSingle();
    item = data;
  }

  return NextResponse.json({ added, skipped, item });
}
