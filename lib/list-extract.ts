// Extraction for a direct-add-by-URL list item — a near-duplicate of
// lib/extract.ts's runExtraction, targeting list_items instead of
// submissions. Kept separate rather than parameterizing runExtraction: the
// two tables' columns overlap but aren't identical (list_items has no
// status/segment/submitter fields; submissions has no `note`/`added_by`),
// and playlist expansion doesn't apply here — a list item is always exactly
// one row, added by a person putting one thing on a list, not chat pushing
// through hundreds of drive-by links. The kind→extractor dispatch and the
// enrichment step ARE shared, though — see lib/extract-kind.ts.

import { supabaseAdmin } from './supabase';
import { hostDMCARisk } from './enrich';
import { recordUsage } from './usage';
import { extractMetaForKind, enrichExtractedMeta } from './extract-kind';

export async function runListItemExtraction(itemId: string, streamId: string) {
  const sb = supabaseAdmin();
  const { data: item, error } = await sb
    .from('list_items')
    .select('*')
    .eq('id', itemId)
    .single();
  if (error || !item) return;

  try {
    // Unlike runExtraction, a kind with no dedicated extractor (twitch_clip,
    // twitch_vod, unknown, or a playlist that somehow landed here) skips
    // enrichment entirely and keeps the bare URL — a shelf item is worth
    // less guessing than a chat-fed submission. See extractMetaForKind's doc
    // comment in lib/extract-kind.ts.
    const meta = await extractMetaForKind(item.url, item.kind);
    if (!meta) return;

    const enriched = await enrichExtractedMeta({
      url: item.url,
      kind: item.kind,
      meta,
      streamId,
    });

    await sb.from('list_items').update({
      title: meta.title,
      description: meta.description,
      thumbnail_url: meta.thumbnail,
      publisher: meta.publisher,
      author: meta.author,
      published_at: meta.publishedAt,
      duration_seconds: meta.duration,
      summary: enriched.summary,
      credibility_tag: enriched.credibility,
      topics: enriched.topics,
      dmca_risk: enriched.dmcaRisk,
    }).eq('id', item.id);

    await recordUsage({ streamId, kind: 'extract', meta: { kind: item.kind, source: 'list_item' } });

    if (enriched.contentWarning) {
      await sb.from('list_items').update({ content_warning: enriched.contentWarning }).eq('id', item.id);
    }
  } catch (err) {
    console.error('list item extraction failed for', itemId, err);
    await sb.from('list_items').update({ dmca_risk: hostDMCARisk(item.url) }).eq('id', item.id);
  }
}
