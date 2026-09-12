import { supabaseAdmin } from './supabase';
import { hostDMCARisk } from './enrich';
import { recordUsage } from './usage';
import { extractMetaForKind, enrichExtractedMeta } from './extract-kind';

export async function runExtraction(submissionId: string) {
  const sb = supabaseAdmin();
  const { data: sub, error } = await sb
    .from('submissions')
    .select('*')
    .eq('id', submissionId)
    .single();
  if (error || !sub) return;

  try {
    // A playlist link posted in chat is NOT expanded here — that used to
    // fan a single pending submission out into one bare, unenriched pending
    // row per video (see git history), which is all cost and no benefit for
    // a link nobody's decided to put on the deck yet: every one of those
    // rows sat in the queue with no title or thumbnail, since nothing ever
    // ran extraction on the fanned-out rows themselves. A mod reviewing the
    // single pending playlist link now sees it enriched like any other link
    // (title/thumbnail via the article fallback below, since YouTube's
    // playlist pages carry normal OG tags) and can approve it as one item,
    // or use "Add to deck" (lib/deck-add.ts's addToDeck) — which still does
    // the full per-video expansion — if they actually want it split up.
    //
    // No dedicated extractor (twitch_clip, twitch_vod, youtube_playlist,
    // unknown) degrades to treating the URL as an article — see
    // extractMetaForKind's doc comment in lib/extract-kind.ts for why
    // that's the right fallback here (and NOT in list-extract.ts, which
    // skips enrichment entirely instead).
    const meta =
      (await extractMetaForKind(sub.url, sub.kind)) ??
      (await extractMetaForKind(sub.url, 'article'))!;

    const enriched = await enrichExtractedMeta({
      url: sub.url,
      kind: sub.kind,
      meta,
      streamId: sub.stream_id,
    });

    await sb.from('submissions').update({
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
    }).eq('id', sub.id);

    // One extract event per processed item (covers the YouTube/article fetches).
    await recordUsage({ streamId: sub.stream_id, kind: 'extract', meta: { kind: sub.kind } });

    // Written separately and guarded so a database without the column
    // (migration not yet run) still gets the full enrichment above.
    if (enriched.contentWarning) {
      const { error: cwErr } = await sb
        .from('submissions')
        .update({ content_warning: enriched.contentWarning })
        .eq('id', sub.id);
      if (cwErr) console.warn('content_warning not written (run the migration?):', cwErr.message);
    }
  } catch (err) {
    console.error('extraction failed for', submissionId, err);
    await sb.from('submissions').update({
      dmca_risk: hostDMCARisk(sub.url),
      mod_notes: 'extraction failed',
    }).eq('id', sub.id);
  }
}
