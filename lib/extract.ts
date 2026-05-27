import { supabaseAdmin } from './supabase';
import { extractArticle } from './extract-article';
import { fetchYouTubeMeta, expandPlaylist } from './extract-youtube';
import { enrichContent, hostDMCARisk } from './enrich';
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

    const enriched = await enrichContent({
      url: sub.url,
      title,
      publisher,
      body: bodyText,
    });

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
  } catch (err) {
    console.error('extraction failed for', submissionId, err);
    await sb.from('submissions').update({
      dmca_risk: hostDMCARisk(sub.url),
      mod_notes: 'extraction failed',
    }).eq('id', sub.id);
  }
}
