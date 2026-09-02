import { supabaseAdmin } from './supabase';
import { extractArticle } from './extract-article';
import { fetchYouTubeMeta, expandPlaylist } from './extract-youtube';
import { extractTwitter } from './extract-twitter';
import { extractTikTok } from './extract-tiktok';
import { enrichContent, hostDMCARisk } from './enrich';
import { scanContentWarning } from './content-warning';
import { recordUsage } from './usage';
import { detectKind, normalizeUrl } from './url';

export async function runExtraction(submissionId: string) {
  const sb = supabaseAdmin();
  const { data: sub, error } = await sb
    .from('submissions')
    .select('*')
    .eq('id', submissionId)
    .single();
  if (error || !sub) return;

  try {
    let title: string | null = null;
    let description: string | null = null;
    let thumbnail: string | null = null;
    let publisher: string | null = null;
    let author: string | null = null;
    let publishedAt: string | null = null;
    let duration: number | null = null;
    let bodyText: string | null = null;

    if (sub.kind === 'youtube' || sub.kind === 'youtube_short') {
      const meta = await fetchYouTubeMeta(sub.url);
      title = meta.title;
      description = meta.description;
      thumbnail = meta.thumbnail;
      publisher = meta.publisher;
      publishedAt = meta.publishedAt;
      duration = meta.durationSeconds;
      bodyText = [meta.description, meta.transcript].filter(Boolean).join('\n\n');
    } else if (sub.kind === 'youtube_playlist') {
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
    } else if (sub.kind === 'twitter') {
      const meta = await extractTwitter(sub.url);
      title = meta.title;
      description = meta.description;
      publisher = 'X / Twitter';
      author = meta.author;
      bodyText = meta.description;
    } else if (sub.kind === 'tiktok') {
      const meta = await extractTikTok(sub.url);
      title = meta.title;
      description = meta.description;
      thumbnail = meta.thumbnail;
      publisher = meta.publisher;
      author = meta.author;
      publishedAt = meta.publishedAt;
      duration = meta.durationSeconds;
      bodyText = meta.description;
    } else {
      const meta = await extractArticle(sub.url);
      title = meta.title;
      description = meta.description;
      thumbnail = meta.thumbnail;
      publisher = meta.publisher;
      author = meta.author;
      publishedAt = meta.publishedAt;
      bodyText = meta.description;
    }

    // Tweets are short enough to read verbatim — skip the AI summary/analysis
    // and just keep the tweet text (stored as `description`).
    const enriched =
      sub.kind === 'twitter'
        ? { summary: null, credibility: null, topics: null as string[] | null, dmcaRisk: null, contentWarning: false }
        : await enrichContent({ url: sub.url, title, publisher, body: bodyText, streamId: sub.stream_id });

    await sb.from('submissions').update({
      title,
      description,
      thumbnail_url: thumbnail,
      publisher,
      author,
      published_at: publishedAt,
      duration_seconds: duration,
      summary: enriched.summary,
      credibility_tag: enriched.credibility,
      topics: enriched.topics,
      dmca_risk: enriched.dmcaRisk || hostDMCARisk(sub.url),
    }).eq('id', sub.id);

    // One extract event per processed item (covers the YouTube/article fetches).
    await recordUsage({ streamId: sub.stream_id, kind: 'extract', meta: { kind: sub.kind } });

    // Graphic-content flag: explicit warning words in the title/description, or
    // the AI judging the content likely shows disturbing imagery. Written
    // separately and guarded so a database without the column (migration not
    // yet run) still gets the full enrichment above.
    const contentWarning =
      scanContentWarning(title, description) ||
      (enriched.contentWarning ? 'Possible graphic content (AI-flagged)' : null);
    if (contentWarning) {
      const { error: cwErr } = await sb
        .from('submissions')
        .update({ content_warning: contentWarning })
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
