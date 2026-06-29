import { supabaseAdmin } from './supabase';

// Metered/paid operations we track for cost + volume insight.
export type UsageKind = 'ai_enrich' | 'coverage_search' | 'extract';

/**
 * Record one usage event. Best-effort and completely fire-safe: any failure
 * (missing env, table not migrated yet, network) is swallowed so metering can
 * never break the operation it's measuring. Awaited inserts are tiny.
 */
export async function recordUsage(input: {
  streamId: string | null;
  kind: UsageKind;
  units?: number; // billable requests, or 1 per processed item
  meta?: Record<string, unknown>; // model, token counts, item kind, etc.
}): Promise<void> {
  try {
    const sb = supabaseAdmin();
    const { error } = await sb.from('usage_events').insert({
      stream_id: input.streamId,
      kind: input.kind,
      units: input.units ?? 1,
      meta: input.meta ?? {},
    });
    // Swallow errors (e.g. table not created yet) — this is observational only.
    if (error) return;
  } catch {
    // Never throw from metering.
  }
}
