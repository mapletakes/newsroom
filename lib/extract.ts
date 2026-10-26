import { supabaseAdmin } from './supabase';
import { hostDMCARisk } from './enrich';
import { scanContentWarning } from './content-warning';
import { recordUsage } from './usage';
import { extractMetaForKind, enrichExtractedMeta } from './extract-kind';

// Pending links get metadata and free risk signals. Approved links are
// enriched under a durable lease in submission-enrichment.ts.
export async function extractSubmissionFields(
  sub: { url: string; kind: string; stream_id: string },
  includeAi: boolean,
): Promise<{ fields: Record<string, unknown>; failureReason?: string }> {
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
    dmca_risk: hostDMCARisk(sub.url),
    content_warning: scanContentWarning(meta.title, meta.description),
  };
  let failureReason: string | undefined;
  if (includeAi) {
    const enriched = await enrichExtractedMeta({
      url: sub.url, kind: sub.kind, meta, streamId: sub.stream_id,
    });
    failureReason = enriched.failureReason;
    if (!failureReason) Object.assign(patch, {
      summary: enriched.summary,
      credibility_tag: enriched.credibility,
      topics: enriched.topics,
      dmca_risk: enriched.dmcaRisk,
      content_warning: enriched.contentWarning,
    });
  }
  await recordUsage({ streamId: sub.stream_id, kind: 'extract', meta: { kind: sub.kind } });
  return { fields: patch, failureReason };
}

async function extractAndWrite(submissionId: string, includeAi: boolean): Promise<void> {
  const sb = supabaseAdmin();
  const { data: sub, error } = await sb
    .from('submissions')
    .select('*')
    .eq('id', submissionId)
    .single();
  if (error || !sub) return;

  try {
    const { fields } = await extractSubmissionFields(sub, includeAi);
    // Basic extraction started while pending must not overwrite the stronger
    // AI risk signals after a moderator approves the item in another tab.
    const { error: writeError } = await sb.from('submissions').update(fields).eq('id', sub.id).eq('status', 'pending');
    if (writeError) throw writeError;
  } catch (err) {
    console.error(`${includeAi ? 'AI enrichment' : 'extraction'} failed for`, submissionId, err);
    await sb.from('submissions').update({
      dmca_risk: hostDMCARisk(sub.url),
    }).eq('id', sub.id).eq('status', 'pending');
  }
}

export function runBasicExtraction(submissionId: string): Promise<void> {
  return extractAndWrite(submissionId, false);
}

// Direct-add still waits for its metadata, but uses the same claim as queue
// approval so a concurrent queue read cannot start a second paid call.
export async function runExtraction(submissionId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { data } = await sb.from('submissions').select('stream_id').eq('id', submissionId).single();
  if (!data) return;
  const { processSubmissionEnrichment } = await import('./submission-enrichment');
  await processSubmissionEnrichment(submissionId, data.stream_id);
}
