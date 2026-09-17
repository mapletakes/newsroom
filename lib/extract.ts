import { supabaseAdmin } from './supabase';
import { hostDMCARisk } from './enrich';
import { scanContentWarning } from './content-warning';
import { recordUsage } from './usage';
import { extractMetaForKind, enrichExtractedMeta } from './extract-kind';

// Split into two phases, run at two different moments:
//
//  - runBasicExtraction: title/thumbnail/publisher/etc, plus the free
//    heuristic DMCA/content-warning signals (hostDMCARisk, scanContentWarning
//    — deterministic, no API call). Runs on every pending chat submission
//    (see lib/submit-url.ts) so mod triage still has a title and thumbnail
//    to look at, same as before.
//  - runAiEnrichment: the Claude call (summary/credibility/topics/the AI's
//    own content-warning judgment) — the actually-billed part. This used to
//    run on every submission too, but most pending links never get
//    approved, so that was paying for a summary of every dead-end link chat
//    posts, not just the ones that make the deck. It now runs only once an
//    item is approved (see app/api/queue/route.ts's PATCH handler), gated
//    on `!summary` so a re-approval (Undo, or unapprove/reapprove) doesn't
//    pay for it twice. Re-extracts metadata fresh rather than trusting
//    what runBasicExtraction stored, so the AI still sees full-fidelity
//    input — a YouTube transcript, a freshly-scraped article body — not a
//    stale summary of a summary; extraction itself is a free HTTP fetch,
//    so doing it twice for the (much smaller) approved subset costs nothing
//    an approval action wasn't already going to spend time on.
//
// runExtraction composes both, immediately — for the one case where there's
// no separate "pending, then later approved" moment to defer the second
// phase to: addToDeck (lib/deck-add.ts) inserts a link already `approved`,
// via "Add to deck" or the browser extension's quick-add.
async function extractAndWrite(submissionId: string, includeAi: boolean): Promise<void> {
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

    const patch: Record<string, unknown> = {
      title: meta.title,
      description: meta.description,
      thumbnail_url: meta.thumbnail,
      publisher: meta.publisher,
      author: meta.author,
      published_at: meta.publishedAt,
      duration_seconds: meta.duration,
    };

    let contentWarning: string | null;

    if (includeAi) {
      const enriched = await enrichExtractedMeta({
        url: sub.url,
        kind: sub.kind,
        meta,
        streamId: sub.stream_id,
      });
      patch.summary = enriched.summary;
      patch.credibility_tag = enriched.credibility;
      patch.topics = enriched.topics;
      patch.dmca_risk = enriched.dmcaRisk;
      contentWarning = enriched.contentWarning;
    } else {
      // Same DMCA/content-warning heuristics enrichExtractedMeta would fall
      // back to anyway (hostDMCARisk, scanContentWarning) — just without
      // ever calling enrichContent (the Claude request) to get there.
      patch.dmca_risk = hostDMCARisk(sub.url);
      contentWarning = scanContentWarning(meta.title, meta.description);
    }

    await sb.from('submissions').update(patch).eq('id', sub.id);

    // One extract event per processed item (covers the YouTube/article fetches).
    await recordUsage({ streamId: sub.stream_id, kind: 'extract', meta: { kind: sub.kind } });

    // Written separately and guarded so a database without the column
    // (migration not yet run) still gets the full enrichment above.
    if (contentWarning) {
      const { error: cwErr } = await sb
        .from('submissions')
        .update({ content_warning: contentWarning })
        .eq('id', sub.id);
      if (cwErr) console.warn('content_warning not written (run the migration?):', cwErr.message);
    }
  } catch (err) {
    console.error(`${includeAi ? 'AI enrichment' : 'extraction'} failed for`, submissionId, err);
    await sb.from('submissions').update({
      dmca_risk: hostDMCARisk(sub.url),
      mod_notes: includeAi ? 'enrichment failed' : 'extraction failed',
    }).eq('id', sub.id);
  }
}

export function runBasicExtraction(submissionId: string): Promise<void> {
  return extractAndWrite(submissionId, false);
}

export function runAiEnrichment(submissionId: string): Promise<void> {
  return extractAndWrite(submissionId, true);
}

export function runExtraction(submissionId: string): Promise<void> {
  return extractAndWrite(submissionId, true);
}
