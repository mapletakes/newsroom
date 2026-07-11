// Public, token-gated read of a shared clip file — no session required. Same
// trust model as the OBS overlay endpoint: a bare token in the URL, rate
// limited, service-role query, no anon DB access.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRateLimit, hashKey } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!token) return NextResponse.json({ error: 'missing token' }, { status: 400 });

  const limited = await checkRateLimit('read', hashKey(token));
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'rate limited, try again shortly' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  const sb = supabaseAdmin();
  const { data: list } = await sb
    .from('lists')
    .select('id, name, updated_at, stream_id')
    .eq('share_token', token)
    .maybeSingle();
  if (!list) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: stream } = await sb
    .from('streams')
    .select('display_name, twitch_login')
    .eq('id', list.stream_id)
    .maybeSingle();

  const { data: items } = await sb
    .from('list_items')
    .select('id, url, kind, title, description, thumbnail_url, publisher, author, duration_seconds, published_at, summary, credibility_tag, topics, dmca_risk, content_warning, note, added_by, position, created_at')
    .eq('list_id', list.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  return NextResponse.json({
    list: { name: list.name, updated_at: list.updated_at },
    streamer: { displayName: stream?.display_name || stream?.twitch_login || 'A streamer', login: stream?.twitch_login || null },
    items: items || [],
  });
}
