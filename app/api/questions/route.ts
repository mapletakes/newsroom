import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession, getApprovedSession } from '@/lib/session';
import { broadcastQuestionsChange } from '@/lib/realtime';

// No POST here — ingestion is chat-only, via the !question-style command in
// app/api/twitch/eventsub/route.ts (see lib/submit-question.ts). There's no
// "streamer/mod types a question in by hand" path in v1.

const STATUSES = ['pending', 'approved', 'rejected', 'answered'] as const;
type Status = (typeof STATUSES)[number];
function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

/** Any mod or the streamer may triage questions — same class of action as
 *  approve/reject on submissions, which every mod can already do regardless
 *  of can_curate (that permission is specifically about deck ORGANIZING). */
async function questionsEnabledFor(streamId: string): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data } = await sb.from('streams').select('questions_enabled').eq('id', streamId).maybeSingle();
  return data?.questions_enabled === true;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  // Defense in depth, not the primary gate: app/questions/page.tsx checks
  // this server-side before ever mounting the client view, so normal
  // navigation never reaches here while disabled. This catches a tab left
  // open across a super admin flipping the flag off mid-session.
  if (!(await questionsEnabledFor(session.streamId))) {
    return NextResponse.json({ error: 'questions not enabled' }, { status: 403 });
  }

  const status = req.nextUrl.searchParams.get('status');
  const sb = supabaseAdmin();
  let q = sb
    .from('questions')
    .select('*')
    .eq('stream_id', session.streamId)
    .order('position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const [pending, approved, rejected, answered, total] = await Promise.all(
    ([...STATUSES, null] as (Status | null)[]).map((s) => {
      let c = sb.from('questions').select('*', { count: 'exact', head: true }).eq('stream_id', session.streamId);
      if (s) c = c.eq('status', s);
      return c;
    }),
  );

  return NextResponse.json({
    questions: data || [],
    counts: {
      pending: pending.count ?? 0,
      approved: approved.count ?? 0,
      rejected: rejected.count ?? 0,
      answered: answered.count ?? 0,
      total: total.count ?? 0,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await questionsEnabledFor(session.streamId))) {
    return NextResponse.json({ error: 'questions not enabled' }, { status: 403 });
  }

  const body = await req.json();
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if ('status' in body) {
    if (!isStatus(body.status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    patch.status = body.status;
    if (body.status === 'approved') patch.approved_at = new Date().toISOString();
    if (body.status === 'answered') patch.answered_at = new Date().toISOString();
  }

  // "Bump to top": the one reordering action this needs. No drag-and-drop —
  // a Q&A queue is triaged by approve/reject, not organized like the deck —
  // so setting position below the current minimum is the whole feature.
  if (body.bump === true) {
    const sb = supabaseAdmin();
    const { data: first } = await sb
      .from('questions')
      .select('position')
      .eq('stream_id', session.streamId)
      .order('position', { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    patch.position = (first?.position ?? 0) - 1;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('questions')
    .update(patch)
    .eq('id', id)
    .eq('stream_id', session.streamId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  broadcastQuestionsChange(session.streamId);
  return NextResponse.json({ question: data });
}
