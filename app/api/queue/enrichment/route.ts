import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { getApprovedSession } from '@/lib/session';
import { claimSubmissionEnrichment, runSubmissionEnrichment } from '@/lib/submission-enrichment';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getApprovedSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid submission id' }, { status: 400 });
  }
  try {
    // The RPC checks channel ownership, approval, state, and lease age in
    // one atomic operation. Repeated clicks cannot create duplicate work.
    const job = await claimSubmissionEnrichment(id, session.streamId, true);
    if (!job) return NextResponse.json({ error: 'not retryable' }, { status: 409 });
    waitUntil(runSubmissionEnrichment(job));
    return NextResponse.json({ state: 'running' }, { status: 202 });
  } catch {
    return NextResponse.json({ error: 'could not start enrichment' }, { status: 503 });
  }
}
