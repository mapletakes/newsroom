// Shared submission logic — used by both the queue API (browser) and
// the EventSub webhook handler (server-to-server).

import { supabaseAdmin } from './supabase';
import { detectKind, normalizeUrl, stripYouTubePlaylistContext } from './url';
import { runExtraction } from './extract';
import { broadcastQueueChange } from './realtime';

export type SubmitUrlParams = {
  streamId: string;
  url: string;
  submitter: string;
  isSub?: boolean;
  isMod?: boolean;
  isVip?: boolean;
  message?: string;
};

export type SubmitUrlResult = {
  submission: Record<string, unknown> | null;
  ignored?: boolean;
};

/**
 * Submit a URL to a stream's queue.
 * Handles normalization, dedup, ignored-user filtering, and AI extraction.
 */
export async function submitUrlToQueue(params: SubmitUrlParams): Promise<SubmitUrlResult> {
  const {
    streamId,
    url: rawUrl,
    submitter,
    isSub = false,
    isMod = false,
    isVip = false,
    message,
  } = params;

  // See stripYouTubePlaylistContext's doc comment — a video linked (or
  // clicked) from inside a playlist shouldn't carry that playlist into the
  // stored link or the youtube_playlist-expansion check below.
  const url = stripYouTubePlaylistContext(rawUrl.trim());
  if (!url) return { submission: null };

  const normalized = normalizeUrl(url);
  const kind = detectKind(url);
  const sb = supabaseAdmin();

  // ── Stream settings ────────────────────────────────────────────
  const { data: stream } = await sb
    .from('streams')
    .select('allow_duplicates, ignored_users')
    .eq('id', streamId)
    .single();

  const allowDuplicates = stream?.allow_duplicates ?? false;
  const ignoredUsers: string[] = stream?.ignored_users ?? [];

  if (ignoredUsers.includes(submitter.toLowerCase())) {
    return { submission: null, ignored: true };
  }

  // ── Build row ──────────────────────────────────────────────────
  const row = {
    stream_id: streamId,
    url,
    normalized_url: normalized,
    kind,
    status: 'pending' as const,
    submitter_login: submitter,
    submitter_is_sub: isSub,
    submitter_is_mod: isMod,
    submitter_is_vip: isVip,
    raw_message: message || null,
  };

  // ── Insert + dedup ─────────────────────────────────────────────
  let submission: Record<string, unknown> | null = null;

  if (allowDuplicates) {
    const { data, error } = await sb.from('submissions').insert(row).select().single();
    if (error) return { submission: null };
    submission = data;
  } else {
    // Insert first, then deduplicate — no pre-check needed.
    // Concurrent inserts all converge: the oldest row (by created_at, id) wins.
    const { data, error } = await sb.from('submissions').insert(row).select().single();
    if (error) return { submission: null };
    submission = data;

    const { data: all } = await sb
      .from('submissions')
      .select('id')
      .eq('stream_id', streamId)
      .eq('normalized_url', normalized)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (all && all.length > 1) {
      const keepId = all[0].id;
      const deleteIds = all.slice(1).map((d: { id: string }) => d.id);
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

  // Ping open views so the new row appears immediately (before enrichment).
  if (submission) broadcastQueueChange(streamId);

  // ── AI extraction (title, summary, credibility, etc.) ─────────
  if (submission && !(submission as Record<string, unknown>).title) {
    await runExtraction(submission.id as string);
    const { data: enriched } = await sb
      .from('submissions')
      .select('*')
      .eq('id', submission.id)
      .maybeSingle();
    if (enriched) submission = enriched;
    // Ping again so enriched data (title, summary) refreshes in place.
    broadcastQueueChange(streamId);
  }

  return { submission };
}
