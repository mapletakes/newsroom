import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getApprovedSession } from '@/lib/session';
import { sessionCanSetNowPlaying } from '@/lib/curate';
import { broadcastQueueChange, broadcastQuestionsChange } from '@/lib/realtime';

// Put an approved audience question on the on-air overlay, taking it over
// from whatever's now playing — or clear it (id: null) and let the normal
// card come back.
//
// Gated on can_set_now_playing rather than plain mod access, deliberately.
// Triaging a question (approve/reject/answered, over in /api/questions) is
// screening work every mod does; this puts text on the actual broadcast, which
// is the same class of action as choosing what's on air. A mod who wasn't
// trusted with now-playing shouldn't get there via the Q&A panel instead.
export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session || !(await sessionCanSetNowPlaying(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const id = body.id ? String(body.id) : null;

  const sb = supabaseAdmin();

  // Only approved questions can go on air, and only ones belonging to THIS
  // stream. Both halves matter: the first keeps a question a mod rejected (or
  // hasn't screened yet) off the broadcast even if a stale panel still offers
  // it, and the second means an id from another stream can't be aired here by
  // passing it in the body.
  if (id) {
    const { data: q } = await sb
      .from('questions')
      .select('id, status')
      .eq('id', id)
      .eq('stream_id', session.streamId)
      .maybeSingle();
    if (!q) return NextResponse.json({ error: 'no such question' }, { status: 404 });
    if (q.status !== 'approved') {
      return NextResponse.json(
        { error: 'only an approved question can go on the overlay', detail: `status is ${q.status}` },
        { status: 409 },
      );
    }
  }

  const { error } = await sb
    .from('streams')
    .update({ overlay_question_id: id })
    .eq('id', session.streamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Both topics: the overlay listens on the queue channel (it's "what's on
  // screen" news, and that's the subscription an OBS source already holds),
  // while the deck and mod panels listen on the questions one.
  broadcastQueueChange(session.streamId);
  broadcastQuestionsChange(session.streamId);
  return NextResponse.json({ ok: true, overlayQuestionId: id });
}
