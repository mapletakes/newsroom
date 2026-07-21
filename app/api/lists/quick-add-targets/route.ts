// Token-authed shelf list, for the browser extension's "add to shelf" menu.
// Auth is the personal add token (X-Add-Token header or ?token=).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRateLimit, hashKey } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Add-Token',
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}

export async function GET(req: NextRequest) {
  const token = req.headers.get('x-add-token') || req.nextUrl.searchParams.get('token') || '';
  if (!token) {
    return NextResponse.json({ ok: false, error: 'missing token' }, { status: 400, headers: CORS });
  }

  const limited = await checkRateLimit('read', hashKey(token));
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, error: 'rate limited, try again shortly' },
      { status: 429, headers: { ...CORS, 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('id')
    .eq('add_token', token)
    .maybeSingle();
  if (!stream) {
    return NextResponse.json({ ok: false, error: 'invalid token' }, { status: 401, headers: CORS });
  }

  const { data } = await sb
    .from('lists')
    .select('id, name, position')
    .eq('stream_id', stream.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  const shelves = (data || []).map((l) => ({ id: l.id, name: l.name }));
  return NextResponse.json({ ok: true, shelves }, { headers: CORS });
}
