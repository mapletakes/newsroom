import { supabaseAdmin } from './supabase';
import { expandPlaylist } from './extract-youtube';
import { hostDMCARisk } from './enrich';
import { recordUsage } from './usage';
import { detectKind, normalizeUrl } from './url';
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
    if (sub.kind === 'youtube_playlist') {
      const urls = await expandPlaylist(sub.url);
      for (const u of urls) {
        await sb.from('submissions').insert({
          stream_id: sub.stream_id,
          url: u,
          normalized_url: normalizeUrl(u),
          kind: detectKind(u),
          status: 'pending',
          submitter_login: sub.submitter_login,
          mod_notes: 'expanded from playlist',
        }).then(() => {}, () => {});
      }
      await sb.from('submissions').update({
        status: 'rejected',
        mod_notes: `expanded into ${urls.length} item(s)`,
      }).eq('id', sub.id);
      return;
    }

    // No dedicated extractor (twitch_clip, twitch_vod, unknown) degrades to
    // treating the URL as an article — see extractMetaForKind's doc comment
    // in lib/extract-kind.ts for why that's the right fallback here (and
    // NOT in list-extract.ts, which skips enrichment entirely instead).
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
