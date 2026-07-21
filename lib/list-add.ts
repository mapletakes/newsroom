// Shared "add a link straight to a shelf" logic, used by both the in-app
// session route and the token-authed quick-add route — mirrors deck-add.ts's
// addToDeck, but targeting list_items instead of submissions.

import { supabaseAdmin } from './supabase';
import { detectKind, normalizeUrl } from './url';
import { runListItemExtraction } from './list-extract';

export type AddToListResult = {
  ok: boolean;
  added: number;
  skipped: number;
  itemId?: string;
  error?: string;
};

export async function addUrlToList(
  listId: string,
  streamId: string,
  rawUrl: string,
  addedBy: string,
  segmentId?: string | null,
): Promise<AddToListResult> {
  const url = rawUrl.trim();
  if (!url) return { ok: false, added: 0, skipped: 0, error: 'missing url' };

  const sb = supabaseAdmin();
  const normalized = normalizeUrl(url);

  const { data: existing } = await sb.from('list_items').select('normalized_url').eq('list_id', listId);
  const already = new Set((existing || []).map((r) => r.normalized_url));
  if (already.has(normalized)) return { ok: true, added: 0, skipped: 1 };

  // Resolve the requested segment, ignoring anything that isn't a real
  // segment on this list (so a stale id just falls back to ungrouped).
  let segId: string | null = null;
  if (segmentId) {
    const { data: seg } = await sb
      .from('list_segments')
      .select('id')
      .eq('id', segmentId)
      .eq('list_id', listId)
      .maybeSingle();
    segId = seg?.id ?? null;
  }

  const { data: last } = await sb
    .from('list_items')
    .select('position')
    .eq('list_id', listId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPos = (last?.position ?? 0) + 1;

  const kind = detectKind(url);
  const { data: inserted, error } = await sb
    .from('list_items')
    .insert({
      list_id: listId,
      url,
      normalized_url: normalized,
      kind,
      segment_id: segId,
      added_by: addedBy,
      position: nextPos,
    })
    .select('id')
    .single();
  if (error || !inserted) return { ok: false, added: 0, skipped: 0, error: error?.message || 'insert failed' };

  await runListItemExtraction(inserted.id, streamId);
  return { ok: true, added: 1, skipped: 0, itemId: inserted.id };
}
