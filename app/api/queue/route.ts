import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession, getApprovedSession, sessionLogin } from '@/lib/session';
import { sessionCanCurate } from '@/lib/curate';
import { waitUntil } from '@vercel/functions';
import { processSubmissionEnrichment, recoverSubmissionEnrichment } from '@/lib/submission-enrichment';
import { normalizeTitleOverride } from '@/lib/title-override';
import { submitUrlToQueue } from '@/lib/submit-url';
import { broadcastQueueChange } from '@/lib/realtime';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json();
  const url = String(body.url || '').trim();
  if (!url) return NextResponse.json({ error: 'missing url' }, { status: 400 });

  const result = await submitUrlToQueue({
    streamId: session.streamId,
    url,
    submitter: body.submitter || sessionLogin(session),
    isSub: !!body.isSub,
    isMod: !!body.isMod,
    isVip: !!body.isVip,
    message: body.message,
  });

  if (result.ignored) return NextResponse.json({ ignored: true });
  return NextResponse.json({ submission: result.submission });
}

type QueueOverviewRow = {
  pending: number;
  approved: number;
  played: number;
  rejected: number;
  total: number;
  now_playing: Record<string, unknown> | null;
};

// Old per-status fan-out (5 count queries + a sequential now-playing lookup)
// — kept only as the fallback below, for a database queue_overview() hasn't
// been created in yet (see supabase/migrations/…_add_queue_overview.sql and
// supabase/README.md for the one-time adoption step). Once that migration
// is applied, every request silently takes the single-RPC path instead;
// nothing here needs the code deploy and the migration to land in a
// specific order.
async function legacyOverview(
  sb: ReturnType<typeof supabaseAdmin>,
  streamId: string,
): Promise<QueueOverviewRow> {
  const [pending, approved, played, rejected, total] = await Promise.all([
    sb.from('submissions').select('*', { count: 'exact', head: true })
      .eq('stream_id', streamId).eq('status', 'pending'),
    sb.from('submissions').select('*', { count: 'exact', head: true })
      .eq('stream_id', streamId).eq('status', 'approved'),
    sb.from('submissions').select('*', { count: 'exact', head: true })
      .eq('stream_id', streamId).eq('status', 'played'),
    sb.from('submissions').select('*', { count: 'exact', head: true })
      .eq('stream_id', streamId).eq('status', 'rejected'),
    sb.from('submissions').select('*', { count: 'exact', head: true })
      .eq('stream_id', streamId),
  ]);

  let nowPlaying: Record<string, unknown> | null = null;
  const { data: streamRow, error: srErr } = await sb
    .from('streams')
    .select('now_playing_id')
    .eq('id', streamId)
    .maybeSingle();
  if (!srErr && streamRow?.now_playing_id) {
    const { data: np } = await sb
      .from('submissions')
      .select('*')
      .eq('id', streamRow.now_playing_id)
      .eq('stream_id', streamId)
      .maybeSingle();
    nowPlaying = np || null;
  }

  return {
    pending: pending.count ?? 0,
    approved: approved.count ?? 0,
    played: played.count ?? 0,
    rejected: rejected.count ?? 0,
    total: total.count ?? 0,
    now_playing: nowPlaying,
  };
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

  // Counts (for the tab labels, independent of the active filter) and
  // now-playing (for the mod view), fetched together via one RPC — see
  // queue_overview() in supabase/migrations — instead of the 5 separate
  // per-status counts plus a sequential now-playing lookup this replaced.
  const [{ data, error }, ov] = await Promise.all([
    q,
    sb.rpc('queue_overview', { p_stream_id: session.streamId }).maybeSingle(),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const overview: QueueOverviewRow = !ov.error && ov.data
    ? (ov.data as QueueOverviewRow)
    : await legacyOverview(sb, session.streamId);

  waitUntil(recoverSubmissionEnrichment(session.streamId));

  return NextResponse.json({
    submissions: data || [],
    nowPlaying: overview.now_playing,
    counts: {
      pending: overview.pending,
      approved: overview.approved,
      played: overview.played,
      rejected: overview.rejected,
      total: overview.total,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json();
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  // Status/notes are mod triage; reassigning a segment or position is curation,
  // so gate those fields behind curate permission (the streamer always passes).
  const isCuration = 'segment_id' in body || typeof body.position === 'number';
  if (isCuration && !(await sessionCanCurate(session))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const patch: Record<string, unknown> = {};
  if (body.status) {
    patch.status = body.status;
    if (body.status === 'approved') {
      patch.approved_at = new Date().toISOString();
      // Only recorded for a mod's approval — the streamer approving their
      // own queue isn't "approved by a mod", so leave both null in that
      // case (the deck badge just won't render).
      patch.approved_by_login = session.role === 'mod' ? sessionLogin(session) : null;
      patch.approved_by_display_name = session.role === 'mod' ? session.displayName : null;
    } else if (body.status !== 'played') {
      // Leaving 'approved' for anything other than 'played' (unapprove back
      // to pending, or reject) means it's no longer a mod-approved deck item
      // — clear the attribution so a later re-approval by someone else (or
      // the streamer) doesn't inherit stale credit.
      patch.approved_by_login = null;
      patch.approved_by_display_name = null;
    }
  }
  if (typeof body.position === 'number') patch.position = body.position;
  if (typeof body.mod_notes === 'string') patch.mod_notes = body.mod_notes;
  // Unlike mod_notes, this one accepts an explicit null: a trigger warning is
  // published to chat and the on-air overlay, so taking one back off an item
  // has to be as possible as putting it on.
  if ('trigger_warning' in body) {
    const tw = typeof body.trigger_warning === 'string' ? body.trigger_warning.trim() : '';
    patch.trigger_warning = tw || null;
  }
  // The deck's takeaway box autosaves here as the streamer types (see
  // DeckView's savePrepNote) — so notes about what to watch for survive
  // switching to another item and back, instead of living only in that
  // component's local state until markPlayed finally persists them as the
  // show-notes takeaway. Accepts an explicit null, same reasoning as
  // trigger_warning: clearing a note has to be as possible as writing one.
  if ('prep_note' in body) {
    const pn = typeof body.prep_note === 'string' ? body.prep_note.trim() : '';
    patch.prep_note = pn || null;
  }
  // The database snapshots this takeaway into show_notes atomically with
  // the play transition. It also cancels that note when Played is undone.
  if (body.status === 'played' && 'takeaway' in body) {
    patch.prep_note = typeof body.takeaway === 'string' ? body.takeaway.trim() || null : null;
  }
  // Streamer's replacement for the title shown on the overlay and in the
  // "Watching:" chat post (the scraped title itself is left alone). Accepts
  // an explicit null/blank to clear it, same reasoning as trigger_warning —
  // and like it, not curation-gated: it annotates what viewers see rather
  // than reorganizing the deck.
  if ('title_override' in body) patch.title_override = normalizeTitleOverride(body.title_override);
  if (typeof body.duration_on_screen_s === 'number') patch.duration_on_screen_s = body.duration_on_screen_s;

  const sb = supabaseAdmin();

  // Assign to a segment (or back to ungrouped). Append to the end of the
  // target group so it lands at the bottom of that segment.
  if ('segment_id' in body) {
    let targetSeg: string | null = body.segment_id || null;
    // Ignore a segment id that isn't a real segment on this stream — a
    // stale/foreign id falls back to ungrouped instead of being written
    // (same rule addToDeck applies for the quick-add path).
    if (targetSeg) {
      const { data: seg } = await sb
        .from('segments')
        .select('id')
        .eq('id', targetSeg)
        .eq('stream_id', session.streamId)
        .maybeSingle();
      targetSeg = seg?.id ?? null;
    }
    patch.segment_id = targetSeg;
    let posQ = sb
      .from('submissions')
      .select('position')
      .eq('stream_id', session.streamId)
      .eq('status', 'approved');
    posQ = targetSeg ? posQ.eq('segment_id', targetSeg) : posQ.is('segment_id', null);
    const { data: last } = await posQ
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    patch.position = (last?.position ?? 0) + 1;
  }

  // Keep duplicate checks on the approval path; paid enrichment and related
  // coverage run in the background after the approval has been saved.
  if (body.status === 'approved') {
    const { data: sub } = await sb
      .from('submissions')
      .select('normalized_url')
      .eq('id', id)
      .eq('stream_id', session.streamId)
      .single();

    // The deck must never contain duplicates, regardless of the stream's
    // allow_duplicates setting (which only governs the overall queue). Block
    // approval if the same URL is already approved (i.e. already on the deck).
    if (sub) {
      const { data: dupe } = await sb
        .from('submissions')
        .select('id, segment:segments(name)')
        .eq('stream_id', session.streamId)
        .eq('status', 'approved')
        .eq('normalized_url', sub.normalized_url)
        .neq('id', id)
        .limit(1)
        .maybeSingle();
      if (dupe) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const segName = (dupe as any).segment?.name as string | undefined;
        const where = segName ? `segment “${segName}”` : 'the ungrouped list';
        return NextResponse.json(
          { error: 'duplicate', detail: `Already on the deck — in ${where}.`, segment: segName ?? null },
          { status: 409 },
        );
      }
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

  // The trigger persists queued work atomically with approval. External
  // providers run after the response, under a database lease; queue reads
  // recover work left queued or interrupted by a function timeout.
  if (body.status === 'approved' && data) {
    waitUntil(processSubmissionEnrichment(id, session.streamId));
  }

  broadcastQueueChange(session.streamId);
  return NextResponse.json({ submission: data });
}
