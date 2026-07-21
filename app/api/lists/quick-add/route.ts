// JSON token-authed quick-add to a shelf, for the browser extension (and any
// tool). Auth is the personal add token (X-Add-Token header or body.token).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { addUrlToList } from '@/lib/list-add';
import { checkRateLimit, hashKey } from '@/lib/ratelimit';

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
  let body: { url?: string; token?: string; listId?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const token = req.headers.get('x-add-token') || body.token || '';
  const url = String(body.url || '').trim();
  const listId = String(body.listId || '');
  if (!token || !url || !listId) {
    return NextResponse.json({ ok: false, error: 'missing token, url, or listId' }, { status: 400, headers: CORS });
  }

  const limited = await checkRateLimit('write', hashKey(token));
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, error: 'rate limited, try again shortly' },
      { status: 429, headers: { ...CORS, 'Retry-After': String(limited.retryAfterSeconds) } },
    );
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

  const { data: list } = await sb
    .from('lists')
    .select('id')
    .eq('id', listId)
    .eq('stream_id', stream.id)
    .maybeSingle();
  if (!list) {
    return NextResponse.json({ ok: false, error: 'invalid shelf' }, { status: 400, headers: CORS });
  }

  const result = await addUrlToList(list.id, stream.id, url, stream.twitch_login);
  return NextResponse.json(result, { status: result.ok ? 200 : 400, headers: CORS });
}
