import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { detectKind, normalizeUrl } from '@/lib/url';
import { runExtraction } from '@/lib/extract';
import { expandPlaylistWithMeta } from '@/lib/extract-youtube';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (session.role !== 'streamer') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const url = String(body.url || '').trim();
  if (!url) return NextResponse.json({ error: 'missing url' }, { status: 400 });

  const kind = detectKind(url);
  const sb = supabaseAdmin();

  if (kind === 'youtube_playlist') {
    const videos = await expandPlaylistWithMeta(url);
    if (videos.length === 0) {
      return NextResponse.json({ error: 'could not expand playlist (is YOUTUBE_API_KEY set?)' }, { status: 400 });
    }

    const { data: maxRow } = await sb
      .from('submissions')
      .select('position')
      .eq('stream_id', session.streamId)
      .eq('status', 'approved')
      .not('position', 'is', null)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    let pos = (maxRow?.position ?? 0) + 1;

    const inserted = [];
    for (const v of videos) {
      const { data } = await sb
        .from('submissions')
        .insert({
          stream_id: session.streamId,
          url: v.url,
          normalized_url: normalizeUrl(v.url),
          kind: 'youtube',
          status: 'approved',
          approved_at: new Date().toISOString(),
          title: v.title,
          thumbnail_url: v.thumbnail,
          publisher: v.publisher,
          position: pos++,
          submitter_login: session.twitchLogin,
        })
        .select()
        .single();
      if (data) inserted.push(data);
    }

    return NextResponse.json({ submissions: inserted, expanded: true, count: inserted.length });
  }

  const normalized = normalizeUrl(url);
  const { data: submission, error } = await sb
    .from('submissions')
    .insert({
      stream_id: session.streamId,
      url,
      normalized_url: normalized,
      kind,
      status: 'approved',
      approved_at: new Date().toISOString(),
      submitter_login: session.twitchLogin,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (submission) {
    await runExtraction(submission.id);
    const { data: enriched } = await sb
      .from('submissions')
      .select('*')
      .eq('id', submission.id)
      .maybeSingle();
    if (enriched) return NextResponse.json({ submission: enriched });
  }

  return NextResponse.json({ submission });
}
