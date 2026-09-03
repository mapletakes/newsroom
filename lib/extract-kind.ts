// Shared extraction core for lib/extract.ts (submissions) and
// lib/list-extract.ts (shelf list_items) — the kind→extractor dispatch and
// the enrichment/content-warning step were, until this file existed,
// independently copy-pasted in both callers. That drift had already
// produced a real, undecided divergence: for a kind with no dedicated
// extractor (twitch_clip, twitch_vod, unknown), extract.ts fell through to
// treating the URL as an article while list-extract.ts silently skipped
// enrichment entirely — nobody chose that difference on purpose, it's just
// what two copies of the same block independently drift into. Splitting
// this out means the two callers can only differ where a comment says so.
//
// What stays OUT of here, deliberately: youtube_playlist expansion
// (submissions-only — a shelf item is always exactly one row, never fanned
// out) and the actual DB write (the two tables' columns overlap but aren't
// identical — see list-extract.ts's own file comment).

import { extractArticle } from './extract-article';
import { fetchYouTubeMeta } from './extract-youtube';
import { extractTwitter } from './extract-twitter';
import { extractTikTok } from './extract-tiktok';
import { enrichContent, hostDMCARisk } from './enrich';
import { scanContentWarning } from './content-warning';

export type ExtractedMeta = {
  title: string | null;
  description: string | null;
  thumbnail: string | null;
  publisher: string | null;
  author: string | null;
  publishedAt: string | null;
  duration: number | null;
  bodyText: string | null;
};

/**
 * Fetches metadata for one of the kinds with a dedicated extractor
 * (youtube, youtube_short, twitter, tiktok, article). Returns null for
 * anything else (twitch_clip, twitch_vod, unknown, or a future kind with no
 * case here yet) — deliberately does NOT guess at a fallback itself. What
 * "no dedicated extractor" means is a real product decision each caller
 * makes explicitly:
 *   - runExtraction (submissions) falls back to treating the URL as an
 *     article — Twitch pages do carry OG tags, so this degrades gracefully.
 *   - runListItemExtraction (list_items) skips enrichment entirely and
 *     keeps the bare URL — a shelf item with no extractor isn't worth a
 *     guessed-at summary.
 */
export async function extractMetaForKind(url: string, kind: string): Promise<ExtractedMeta | null> {
  switch (kind) {
    case 'youtube':
    case 'youtube_short': {
      const meta = await fetchYouTubeMeta(url);
      return {
        title: meta.title,
        description: meta.description,
        thumbnail: meta.thumbnail,
        publisher: meta.publisher,
        author: null,
        publishedAt: meta.publishedAt,
        duration: meta.durationSeconds,
        bodyText: [meta.description, meta.transcript].filter(Boolean).join('\n\n'),
      };
    }
    case 'twitter': {
      const meta = await extractTwitter(url);
      return {
        title: meta.title,
        description: meta.description,
        thumbnail: null,
        publisher: 'X / Twitter',
        author: meta.author,
        publishedAt: null,
        duration: null,
        bodyText: meta.description,
      };
    }
    case 'tiktok': {
      const meta = await extractTikTok(url);
      return {
        title: meta.title,
        description: meta.description,
        thumbnail: meta.thumbnail,
        publisher: meta.publisher,
        author: meta.author,
        publishedAt: meta.publishedAt,
        duration: meta.durationSeconds,
        bodyText: meta.description,
      };
    }
    case 'article': {
      const meta = await extractArticle(url);
      return {
        title: meta.title,
        description: meta.description,
        thumbnail: meta.thumbnail,
        publisher: meta.publisher,
        author: meta.author,
        publishedAt: meta.publishedAt,
        duration: null,
        bodyText: meta.description,
      };
    }
    default:
      return null;
  }
}

export type EnrichedFields = {
  summary: string | null;
  credibility: string | null;
  topics: string[] | null;
  dmcaRisk: 'low' | 'medium' | 'high';
  contentWarning: string | null; // human-readable reason, or null
};

/**
 * AI enrichment + content-warning derivation — byte-identical between both
 * callers today. `kind` is always the ORIGINAL submission/item kind, never
 * overridden to 'article' after a fallback in extractMetaForKind: enrichContent's
 * own isArticle branch (the web_fetch-based summary fix) keys off it, and the
 * pre-refactor code already passed the original kind through even when the
 * article extractor ran as a fallback for some other kind — this must not
 * change that.
 */
export async function enrichExtractedMeta(input: {
  url: string;
  kind: string;
  meta: ExtractedMeta;
  streamId: string | null;
}): Promise<EnrichedFields> {
  // Tweets are short enough to read verbatim — skip the AI summary/analysis
  // and just keep the tweet text (stored as `description`).
  const enriched =
    input.kind === 'twitter'
      ? { summary: null, credibility: null, topics: null as string[] | null, dmcaRisk: null, contentWarning: false }
      : await enrichContent({
          url: input.url,
          title: input.meta.title,
          publisher: input.meta.publisher,
          body: input.meta.bodyText,
          kind: input.kind,
          streamId: input.streamId,
        });

  // Graphic-content flag: explicit warning words in the title/description, or
  // the AI judging the content likely shows disturbing imagery.
  const contentWarning =
    scanContentWarning(input.meta.title, input.meta.description) ||
    (enriched.contentWarning ? 'Possible graphic content (AI-flagged)' : null);

  return {
    summary: enriched.summary,
    credibility: enriched.credibility,
    topics: enriched.topics,
    dmcaRisk: enriched.dmcaRisk || hostDMCARisk(input.url),
    contentWarning,
  };
}
