import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Coerce raw user input into a usable URL (prepend https:// when no scheme).
function normalizeUrl(raw: string): string | null {
  let u = raw.trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    new URL(u);
    return u;
  } catch {
    return null;
  }
}

// GET — this stream's on-hand links, in display order.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('quick_links')
    .select('id, label, url, position')
    .eq('stream_id', session.streamId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  // Degrade gracefully if the migration hasn't been run yet.
  if (error) return NextResponse.json({ links: [] });
  return NextResponse.json({ links: data || [] });
}

// POST — add a link, appended to the end. Streamer only (personal stash).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (session.role !== 'streamer') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const url = normalizeUrl(String(body.url || ''));
  if (!url) return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  // Fall back to the hostname when no label was given.
  const rawLabel = String(body.label || '').trim();
  const label = (rawLabel || new URL(url).hostname.replace(/^www\./, '')).slice(0, 80);

  const sb = supabaseAdmin();
  const { data: last } = await sb
    .from('quick_links')
    .select('position')
    .eq('stream_id', session.streamId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (last?.position ?? 0) + 1;

  const { data, error } = await sb
    .from('quick_links')
    .insert({ stream_id: session.streamId, label, url, position })
    .select('id, label, url, position')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ link: data });
}

// PATCH — reorder (ids[] in new order) or rename/retarget a single link.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (session.role !== 'streamer') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const sb = supabaseAdmin();

  if (Array.isArray(body.ids)) {
    await Promise.all(
      body.ids.map((id: string, i: number) =>
        sb.from('quick_links')
          .update({ position: i + 1 })
          .eq('id', id)
          .eq('stream_id', session.streamId),
      ),
    );
    return NextResponse.json({ ok: true });
  }

  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (typeof body.label === 'string') patch.label = body.label.trim().slice(0, 80) || 'Link';
  if (typeof body.url === 'string') {
    const u = normalizeUrl(body.url);
    if (!u) return NextResponse.json({ error: 'invalid url' }, { status: 400 });
    patch.url = u;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }
  const { error } = await sb
    .from('quick_links')
    .update(patch)
    .eq('id', id)
    .eq('stream_id', session.streamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE — remove a link. Streamer only.
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (session.role !== 'streamer') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const sb = supabaseAdmin();
  const { error } = await sb
    .from('quick_links')
    .delete()
    .eq('id', id)
    .eq('stream_id', session.streamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
