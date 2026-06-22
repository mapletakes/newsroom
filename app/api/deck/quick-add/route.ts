// JSON token-authed quick-add, for the browser extension (and any tool).
// Auth is the personal add token (X-Add-Token header or body.token).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { addToDeck } from '@/lib/deck-add';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Add-Token',
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}

export async function POST(req: NextRequest) {
  let body: { url?: string; token?: string; segmentId?: string | null } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const token = req.headers.get('x-add-token') || body.token || '';
  const url = String(body.url || '').trim();
  const segmentId = body.segmentId ? String(body.segmentId) : null;
  if (!token || !url) {
    return NextResponse.json({ ok: false, error: 'missing token or url' }, { status: 400, headers: CORS });
  }

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('id, twitch_login')
    .eq('add_token', token)
    .maybeSingle();
  if (!stream) {
    return NextResponse.json({ ok: false, error: 'invalid token' }, { status: 401, headers: CORS });
  }

  const result = await addToDeck(stream.id, url, stream.twitch_login, segmentId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400, headers: CORS });
}
