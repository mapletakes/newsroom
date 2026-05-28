import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { detectKind, normalizeUrl } from '@/lib/url';
import { runExtraction } from '@/lib/extract';
import { searchRelatedCoverage } from '@/lib/search-coverage';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json();
  const url = String(body.url || '').trim();
  if (!url) return NextResponse.json({ error: 'missing url' }, { status: 400 });

  const normalized = normalizeUrl(url);
  const kind = detectKind(url);

  const sb = supabaseAdmin();

  const { data: stream } = await sb
    .from('streams')
    .select('allow_duplicates, ignored_users')
    .eq('id', session.streamId)
    .single();
  const allowDuplicates = stream?.allow_duplicates ?? false;
  const ignoredUsers: string[] = stream?.ignored_users ?? [];

  const submitter = String(body.submitter || session.twitchLogin).toLowerCase();
  if (ignoredUsers.includes(submitter)) {
    return NextResponse.json({ ignored: true });
  }

  const row = {
    stream_id: session.streamId,
    url,
    normalized_url: normalized,
    kind,
    status: 'pending' as const,
    submitter_login: body.submitter || session.twitchLogin,
    submitter_is_sub: !!body.isSub,
    submitter_is_mod: !!body.isMod,
    submitter_is_vip: !!body.isVip,
    raw_message: body.message || null,
  };

  let submission: Record<string, unknown> | null = null;

  if (allowDuplicates) {
    const { data, error } = await sb
      .from('submissions')
      .insert(row)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    submission = data;
  } else {
    // Check for existing submission with same URL
    const { data: existing } = await sb
      .from('submissions')
      .select('*')
      .eq('stream_id', session.streamId)
      .eq('normalized_url', normalized)
      .maybeSingle();

    if (existing) {
      submission = existing;
    } else {
      const { data, error } = await sb
        .from('submissions')
        .insert(row)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      submission = data;

      // Race-condition cleanup: if multiple listeners inserted the same
      // URL simultaneously, keep the oldest and delete the rest.
      const { data: dupes } = await sb
        .from('submissions')
        .select('id')
        .eq('stream_id', session.streamId)
        .eq('normalized_url', normalized)
        .order('created_at', { ascending: true });

      if (dupes && dupes.length > 1) {
        const keepId = dupes[0].id;
        const deleteIds = dupes.slice(1).map((d) => d.id);
        await sb.from('submissions').delete().in('id', deleteIds);
        if (data.id !== keepId) {
          const { data: kept } = await sb
            .from('submissions')
            .select('*')
            .eq('id', keepId)
            .maybeSingle();
          submission = kept;
        }
      }
    }
  }

  // Run extraction inline if submission has no enrichment yet
  if (submission && !submission.title) {
    await runExtraction(submission.id as string);
    // Re-fetch the enriched submission to return updated data
    const { data: enriched } = await sb
      .from('submissions')
      .select('*')
      .eq('id', submission.id)
      .maybeSingle();
    if (enriched) submission = enriched;
  }

  return NextResponse.json({ submission });
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
