import { randomUUID } from 'crypto';
import { supabaseAdmin } from './supabase';
import { extractSubmissionFields } from './extract';
import { searchRelatedCoverage } from './search-coverage';
import { broadcastQueueChange } from './realtime';

export type EnrichmentJob = {
  id: string;
  stream_id: string;
  url: string;
  kind: string;
  title: string | null;
  publisher: string | null;
  related_coverage: unknown;
  enrichment_token: string;
};

export async function claimSubmissionEnrichment(
  id: string, streamId: string, retry = false,
): Promise<EnrichmentJob | null> {
  const { data, error } = await supabaseAdmin().rpc('claim_submission_enrichment', {
    p_id: id, p_stream_id: streamId, p_token: randomUUID(), p_retry: retry,
  }).maybeSingle();
  if (error) throw new Error('Could not claim enrichment work.', { cause: error });
  return data as EnrichmentJob | null;
}

export async function runSubmissionEnrichment(job: EnrichmentJob): Promise<void> {
  const sb = supabaseAdmin();
  try {
    const { fields, failureReason } = await extractSubmissionFields(job, true);
    if (!failureReason && job.kind === 'article' && !job.related_coverage && (fields.title || job.title)) {
      const { data: settings } = await sb.from('streams').select('preferred_sources')
        .eq('id', job.stream_id).single();
      fields.related_coverage = await searchRelatedCoverage({
        title: (fields.title as string | null) || job.title,
        publisher: (fields.publisher as string | null) || job.publisher,
        url: job.url, preferredSources: settings?.preferred_sources ?? [], streamId: job.stream_id,
      });
    }
    const { error } = await sb.from('submissions').update({
      ...fields,
      enrichment_state: failureReason ? 'failed' : job.kind === 'twitter' ? 'skipped' : 'complete',
      enrichment_error: failureReason ? 'Enrichment could not finish. You can retry it.' : null,
      enrichment_token: null,
      enrichment_updated_at: new Date().toISOString(),
    }).eq('id', job.id).eq('stream_id', job.stream_id).eq('enrichment_token', job.enrichment_token);
    if (error) throw new Error('Could not save enrichment results.', { cause: error });
  } catch (error) {
    console.error('Submission enrichment failed:', job.id, error);
    // Never put provider responses or credentials into user-visible notes.
    // Keep editorial mod_notes intact and fence every write by its lease.
    const { error: writeError } = await sb.from('submissions').update({
      enrichment_state: 'failed',
      enrichment_error: 'Enrichment could not finish. You can retry it.',
      enrichment_token: null,
      enrichment_updated_at: new Date().toISOString(),
    }).eq('id', job.id).eq('stream_id', job.stream_id).eq('enrichment_token', job.enrichment_token);
    if (writeError) console.error('Could not record enrichment failure:', job.id, writeError);
  } finally {
    await broadcastQueueChange(job.stream_id);
  }
}

export async function processSubmissionEnrichment(id: string, streamId: string): Promise<void> {
  try {
    const job = await claimSubmissionEnrichment(id, streamId);
    if (job) await runSubmissionEnrichment(job);
  } catch (error) {
    // The queued row stays durable if claiming fails. A later read or the
    // cleanup job can try again, without failing an already-saved approval.
    console.error('Could not start submission enrichment:', id, error);
  }
}

export async function recoverSubmissionEnrichment(streamId?: string): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
    let query = supabaseAdmin().from('submissions').select('id, stream_id, streams!inner(approved)')
      .eq('status', 'approved')
      .not('streams.approved', 'is', false)
      .is('summary', null)
      .or(`enrichment_state.eq.queued,and(enrichment_state.eq.running,enrichment_updated_at.lt.${cutoff})`)
      .order('enrichment_updated_at', { ascending: true }).limit(3);
    if (streamId) query = query.eq('stream_id', streamId);
    const { data, error } = await query;
    if (error) throw error;
    await Promise.all((data ?? []).map((row) => processSubmissionEnrichment(row.id, row.stream_id)));
  } catch (error) {
    console.error('Could not recover submission enrichment:', error);
  }
}
