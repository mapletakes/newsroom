// Shared "add a link straight to the streamer deck (approved)" logic, used by
// both the in-app session route and the token-authed quick-add route.

import { supabaseAdmin } from './supabase';
import { detectKind, normalizeUrl } from './url';
import { runExtraction } from './extract';
import { expandPlaylistWithMeta } from './extract-youtube';
import { broadcastQueueChange } from './realtime';

export type AddToDeckResult = {
  ok: boolean;
  expanded: boolean;
  count: number;
  title?: string | null;
  error?: string;
};

export async function addToDeck(
  streamId: string,
  rawUrl: string,
  submitterLogin: string,
  segmentId?: string | null,
): Promise<AddToDeckResult> {
  const url = rawUrl.trim();
  if (!url) return { ok: false, expanded: false, count: 0, error: 'missing url' };

  const kind = detectKind(url);
  const sb = supabaseAdmin();

  // Resolve the requested segment, ignoring anything that isn't a real segment
  // on this stream (so a stale id just falls back to ungrouped).
  let segId: string | null = null;
  if (segmentId) {
    const { data: seg } = await sb
      .from('segments')
      .select('id')
      .eq('id', segmentId)
      .eq('stream_id', streamId)
      .maybeSingle();
    segId = seg?.id ?? null;
  }

  // ── Playlist → expand into individual approved videos ───────────
  if (kind === 'youtube_playlist') {
    const videos = await expandPlaylistWithMeta(url);
    if (videos.length === 0) {
      return { ok: false, expanded: false, count: 0, error: 'could not expand playlist' };
    }

    // The deck never duplicates: skip videos already approved (and skip repeats
    // within the playlist itself).
    const { data: existing } = await sb
      .from('submissions')
      .select('normalized_url')
      .eq('stream_id', streamId)
      .eq('status', 'approved');
    const onDeck = new Set((existing ?? []).map((e) => e.normalized_url));

    const { data: maxRow } = await sb
      .from('submissions')
      .select('position')
      .eq('stream_id', streamId)
      .eq('status', 'approved')
      .not('position', 'is', null)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    let pos = (maxRow?.position ?? 0) + 1;

    let count = 0;
    for (const v of videos) {
      const nu = normalizeUrl(v.url);
      if (onDeck.has(nu)) continue;
      onDeck.add(nu);
      const { data } = await sb
        .from('submissions')
        .insert({
          stream_id: streamId,
          url: v.url,
          normalized_url: nu,
          kind: 'youtube',
          status: 'approved',
          approved_at: new Date().toISOString(),
          segment_id: segId,
          title: v.title,
          thumbnail_url: v.thumbnail,
          publisher: v.publisher,
          duration_seconds: v.durationSeconds,
          position: pos++,
          submitter_login: submitterLogin,
        })
        .select('id')
        .single();
      if (data) count++;
    }

    if (count === 0) {
      return { ok: false, expanded: true, count: 0, error: 'Every video in that playlist is already on the deck.' };
    }
    broadcastQueueChange(streamId);
    return { ok: true, expanded: true, count };
  }

  // ── Single link → block deck duplicates, then insert + enrich ──
  const normalized = normalizeUrl(url);
  const { data: dupe } = await sb
    .from('submissions')
    .select('id, segment:segments(name)')
    .eq('stream_id', streamId)
    .eq('status', 'approved')
    .eq('normalized_url', normalized)
    .limit(1)
    .maybeSingle();
  if (dupe) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const segName = (dupe as any).segment?.name as string | undefined;
    const where = segName ? `segment “${segName}”` : 'the ungrouped list';
    return { ok: false, expanded: false, count: 0, error: `Already on the deck — in ${where}.` };
  }

  const { data: submission, error } = await sb
    .from('submissions')
    .insert({
      stream_id: streamId,
      url,
      normalized_url: normalized,
      kind,
      status: 'approved',
      approved_at: new Date().toISOString(),
      segment_id: segId,
      submitter_login: submitterLogin,
    })
    .select('id')
    .single();

  if (error) return { ok: false, expanded: false, count: 0, error: error.message };
  broadcastQueueChange(streamId);

  let title: string | null = null;
  if (submission) {
    await runExtraction(submission.id);
    const { data: enriched } = await sb
      .from('submissions')
      .select('title')
      .eq('id', submission.id)
      .maybeSingle();
    title = enriched?.title ?? null;
    broadcastQueueChange(streamId);
  }

  return { ok: true, expanded: false, count: 1, title };
}
