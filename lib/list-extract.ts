// Extraction for a direct-add-by-URL list item — a near-duplicate of
// lib/extract.ts's runExtraction, targeting list_items instead of
// submissions. Kept separate rather than parameterizing runExtraction: the
// two tables' columns overlap but aren't identical (list_items has no
// status/segment/submitter fields; submissions has no `note`/`added_by`),
// and playlist expansion doesn't apply here — a list item is always exactly
// one row, added by a person putting one thing on a list, not chat pushing
// through hundreds of drive-by links.

import { supabaseAdmin } from './supabase';
import { extractArticle } from './extract-article';
import { fetchYouTubeMeta } from './extract-youtube';
import { extractTwitter } from './extract-twitter';
import { extractTikTok } from './extract-tiktok';
import { enrichContent, hostDMCARisk } from './enrich';
import { scanContentWarning } from './content-warning';
import { recordUsage } from './usage';

export async function runListItemExtraction(itemId: string, streamId: string) {
  const sb = supabaseAdmin();
  const { data: item, error } = await sb
    .from('list_items')
    .select('*')
    .eq('id', itemId)
    .single();
  if (error || !item) return;

  try {
    let title: string | null = null;
    let description: string | null = null;
    let thumbnail: string | null = null;
    let publisher: string | null = null;
    let author: string | null = null;
    let publishedAt: string | null = null;
    let duration: number | null = null;
    let bodyText: string | null = null;

    if (item.kind === 'youtube' || item.kind === 'youtube_short') {
      const meta = await fetchYouTubeMeta(item.url);
      title = meta.title;
      description = meta.description;
      thumbnail = meta.thumbnail;
      publisher = meta.publisher;
      publishedAt = meta.publishedAt;
      duration = meta.durationSeconds;
      bodyText = [meta.description, meta.transcript].filter(Boolean).join('\n\n');
    } else if (item.kind === 'twitter') {
      const meta = await extractTwitter(item.url);
      title = meta.title;
      description = meta.description;
      publisher = 'X / Twitter';
      author = meta.author;
      bodyText = meta.description;
    } else if (item.kind === 'article') {
      const meta = await extractArticle(item.url);
      title = meta.title;
      description = meta.description;
      thumbnail = meta.thumbnail;
      publisher = meta.publisher;
      author = meta.author;
      publishedAt = meta.publishedAt;
      bodyText = meta.description;
    } else if (item.kind === 'tiktok') {
      const meta = await extractTikTok(item.url);
      title = meta.title;
      description = meta.description;
      thumbnail = meta.thumbnail;
      publisher = meta.publisher;
      author = meta.author;
      publishedAt = meta.publishedAt;
      duration = meta.durationSeconds;
      bodyText = meta.description;
    } else {
      // Playlists, clips, and anything else we don't have a dedicated
      // extractor for: keep the bare URL, skip enrichment.
      return;
    }

    const enriched =
      item.kind === 'twitter'
        ? { summary: null, credibility: null, topics: null as string[] | null, dmcaRisk: null, contentWarning: false }
        : await enrichContent({ url: item.url, title, publisher, body: bodyText, streamId });

    await sb.from('list_items').update({
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
      dmca_risk: enriched.dmcaRisk || hostDMCARisk(item.url),
    }).eq('id', item.id);

    await recordUsage({ streamId, kind: 'extract', meta: { kind: item.kind, source: 'list_item' } });

    const contentWarning =
      scanContentWarning(title, description) ||
      (enriched.contentWarning ? 'Possible graphic content (AI-flagged)' : null);
    if (contentWarning) {
      await sb.from('list_items').update({ content_warning: contentWarning }).eq('id', item.id);
    }
  } catch (err) {
    console.error('list item extraction failed for', itemId, err);
    await sb.from('list_items').update({ dmca_risk: hostDMCARisk(item.url) }).eq('id', item.id);
  }
}
