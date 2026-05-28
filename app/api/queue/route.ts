import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { searchRelatedCoverage } from '@/lib/search-coverage';
import { submitUrlToQueue } from '@/lib/submit-url';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json();
  const url = String(body.url || '').trim();
  if (!url) return NextResponse.json({ error: 'missing url' }, { status: 400 });

  const result = await submitUrlToQueue({
    streamId: session.streamId,
    url,
    submitter: body.submitter || session.twitchLogin,
    isSub: !!body.isSub,
    isMod: !!body.isMod,
    isVip: !!body.isVip,
    message: body.message,
  });

  if (result.ignored) return NextResponse.json({ ignored: true });
  return NextResponse.json({ submission: result.submission });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const status = req.nextUrl.searchParams.get('status'); // pending|approved|played|rejected|null
  const sb = supabaseAdmin();
  let q = sb
    .from('submissions')
    .select('*')
    .eq('stream_id', session.streamId)
    .order('position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ submissions: data || [] });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json();
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.status) {
    patch.status = body.status;
    if (body.status === 'approved') patch.approved_at = new Date().toISOString();
    if (body.status === 'played') patch.played_at = new Date().toISOString();
  }
  if (typeof body.position === 'number') patch.position = body.position;
  if (typeof body.mod_notes === 'string') patch.mod_notes = body.mod_notes;
  if (typeof body.duration_on_screen_s === 'number') patch.duration_on_screen_s = body.duration_on_screen_s;

  const sb = supabaseAdmin();

  // On approval, fetch related coverage before writing
  if (body.status === 'approved') {
    const { data: sub } = await sb
      .from('submissions')
      .select('title, publisher, url, related_coverage')
      .eq('id', id)
      .single();
    if (sub && !sub.related_coverage && sub.title) {
      const { data: streamSettings } = await sb
        .from('streams')
        .select('preferred_sources')
        .eq('id', session.streamId)
        .single();
      const coverage = await searchRelatedCoverage({
        title: sub.title,
        publisher: sub.publisher,
        url: sub.url,
        preferredSources: streamSettings?.preferred_sources ?? [],
      });
      if (coverage.length > 0) patch.related_coverage = coverage;
    }
  }

  const { data, error } = await sb
    .from('submissions')
    .update(patch)
    .eq('id', id)
    .eq('stream_id', session.streamId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If marked played, create a show_notes entry
  if (body.status === 'played' && data) {
    await sb.from('show_notes').insert({
      stream_id: session.streamId,
      submission_id: data.id,
      played_at: data.played_at,
      title: data.title,
      url: data.url,
      summary: data.summary,
      takeaway: body.takeaway || null,
    });
  }

  return NextResponse.json({ submission: data });
}
