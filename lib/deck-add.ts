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
): Promise<AddToDeckResult> {
  const url = rawUrl.trim();
  if (!url) return { ok: false, expanded: false, count: 0, error: 'missing url' };

  const kind = detectKind(url);
  const sb = supabaseAdmin();

  // ── Playlist → expand into individual approved videos ───────────
  if (kind === 'youtube_playlist') {
    const videos = await expandPlaylistWithMeta(url);
    if (videos.length === 0) {
      return { ok: false, expanded: false, count: 0, error: 'could not expand playlist' };
    }

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
      const { data } = await sb
        .from('submissions')
        .insert({
          stream_id: streamId,
          url: v.url,
          normalized_url: normalizeUrl(v.url),
          kind: 'youtube',
          status: 'approved',
          approved_at: new Date().toISOString(),
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

    broadcastQueueChange(streamId);
    return { ok: true, expanded: true, count };
  }

  // ── Single link → insert approved, then enrich ─────────────────
  const { data: submission, error } = await sb
    .from('submissions')
    .insert({
      stream_id: streamId,
      url,
      normalized_url: normalizeUrl(url),
      kind,
      status: 'approved',
      approved_at: new Date().toISOString(),
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
