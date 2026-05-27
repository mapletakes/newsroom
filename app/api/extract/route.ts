import { NextRequest, NextResponse } from 'next/server';
import { runExtraction } from '@/lib/extract';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const submissionId = String(body.submissionId || '');
  if (!submissionId) return NextResponse.json({ error: 'missing submissionId' }, { status: 400 });
  await runExtraction(submissionId);
  return NextResponse.json({ ok: true });
}
